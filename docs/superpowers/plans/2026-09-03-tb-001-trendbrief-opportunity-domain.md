# TB-001: TrendBrief Evidence and Opportunity Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one evidence-driven TrendBrief opportunity lifecycle end to end — GSC evidence → deterministic striking-distance detection → persisted opportunity → deterministic recommendation → accept/reject/complete action → outcome comparison — with explicit tenant ownership, versioned detectors, idempotent re-detection, and zero LLM calls.

**Architecture:** A new `src/server/features/trendbrief/` domain layer (`domain/`, `scoring/`, `repositories/`, `services/`, `detectors/`) sits above the existing OpenSEO platform. It reuses `GscService.getPerformance` for evidence, `ProjectContextRepository.listKeyPages` for commercial-relevance matching, and the existing `requireProjectContext`/`withMcpProjectAuth` tenant gates. Six new tables (evidence, opportunity, opportunity_evidence, recommendation, action, outcome) are added as a hand-written D1/Postgres schema pair, guarded by the existing `schema-parity.test.ts`. The only new user-facing surface is four MCP tools mirroring the existing tool-registration convention (`registerOpenSeoTool` in `src/server/mcp/server.ts`).

**Tech Stack:** TanStack Start on Cloudflare Workers, Drizzle ORM (D1/SQLite + Postgres dual schema), Vitest, Zod, MCP SDK (`@modelcontextprotocol/server`).

**Spec:** This plan implements the TB-001 brief provided directly in the session (no separate spec file exists yet in-repo; this plan itself carries the requirements forward). An architecture decision record is produced as part of this plan at `specs/0012-trendbrief-opportunity-domain.md` (Task 15), following the existing `specs/NNNN-title.md` convention (see `specs/0003-google-search-console-integration.md` for the format).

## Global Constraints

- No LLM API call anywhere in this slice. `generation_method` on every persisted recommendation is `"deterministic"`.
- No new DataForSEO (or other paid-provider) calls. Only `GscService.getPerformance` (free Google API, confirmed zero `dataforseo` imports in `src/server/features/gsc`/`ga4`) is used for evidence.
- Every new customer-owned table carries both `organization_id` and `project_id`, and every read/write goes through a function that filters by `project_id` (never a bare-ID lookup with no tenant filter).
- The first detector has an explicit stable identifier: `detectorId = "gsc-striking-distance"`, `detectorVersion = "v1"` (combined key `"gsc-striking-distance:v1"`).
- Repeated processing of identical evidence must not create duplicate active opportunities — enforced by a `dedupe_key` column with a database-level unique index on both dialects.
- Position range (4–20), impression threshold, effort constant, confidence weights, and all other magic numbers are named constants in `src/server/features/trendbrief/scoring/constants.ts` — never inlined.
- D1 (SQLite) and Postgres schemas must stay structurally interchangeable per the existing `src/db/schema-parity.test.ts` guard — every new table is added to both dialect files and both barrel exports in the same task.
- Follow existing repository convention exactly: plain async functions exported as one object per file (no classes), `db` imported from `@/db`, tables imported from `@/db/schema`, `crypto.randomUUID()` for IDs, timestamps as ISO-8601 text computed in application code with `new Date().toISOString()` (not a raw dialect-specific `sql` default reused across an update, which is inconsistent between SQLite's dynamic typing and Postgres's `text`-typed timestamp columns — existing code does this in one place for SQLite compatibility only; this plan avoids replicating that cross-dialect risk in new code).
- Tests are colocated next to source (`Foo.ts` + `Foo.test.ts`, same directory), using Vitest, mocking `@/db` the way `src/server/features/ga4/repositories/Ga4ConnectionRepository.test.ts` does — this repo has no live-database integration-test harness, so repository tests assert on the query-builder calls made, and true DB-level invariants (unique indexes, FK cascades) are covered by `schema-parity.test.ts` plus the generated migration SQL itself, not a live-DB test run.
- Every Postgres-only write path already runs inside `withPgClient` (wired once, at the `fetch`/`scheduled` entrypoints in `src/server.ts:137`) — new repositories/services must NOT call `withPgClient` themselves.

---

### Task 1: TrendBrief database schema (D1 + Postgres) and migrations

**Files:**
- Create: `src/db/trendbrief.schema.ts`
- Create: `src/db/pg/trendbrief.schema.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/d1/schema.ts`
- Modify: `src/db/pg/schema.ts`
- Modify: `src/db/schema-parity.test.ts`
- Generate: `drizzle/00XX_<name>.sql` (via `npm run db:generate:d1`)
- Generate: `drizzle-pg/00XX_<name>.sql` (via `npm run db:generate:pg`)

**Interfaces:**
- Produces: six Drizzle tables — `trendbriefEvidence`, `trendbriefOpportunities`, `trendbriefOpportunityEvidence`, `trendbriefRecommendations`, `trendbriefActions`, `trendbriefOutcomes` — re-exported from `@/db/schema`, consumed by every repository in Tasks 7, 10, 12, 13.

- [ ] **Step 1: Write the D1 schema file**

```ts
// src/db/trendbrief.schema.ts
import { sqliteTable, text, real, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// Normalized, machine-readable measurement (currently GSC page+query
// performance) that a TrendBrief opportunity is traceable back to. One row
// per (project, subject, observation window); `dedupeKey` makes re-ingesting
// the same window idempotent (refreshes metrics/capturedAt in place).
export const trendbriefEvidence = sqliteTable(
  "trendbrief_evidence",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["gsc"] }).notNull(),
    evidenceType: text("evidence_type", {
      enum: ["gsc_page_query_performance"],
    }).notNull(),
    subjectUrl: text("subject_url").notNull(),
    subjectQuery: text("subject_query"),
    observationStart: text("observation_start").notNull(),
    observationEnd: text("observation_end").notNull(),
    dataState: text("data_state", { enum: ["all", "final"] }).notNull(),
    // Small typed JSON payload: {clicks, impressions, ctr, position}. Metrics
    // genuinely vary by evidenceType (a future ga4/business evidence type
    // would carry different fields), so one JSON column is justified over a
    // wide sparse column set — see specs/0012.
    metrics: text("metrics").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("trendbrief_evidence_dedupe_idx").on(table.dedupeKey),
    index("trendbrief_evidence_project_idx").on(
      table.projectId,
      table.capturedAt,
    ),
    index("trendbrief_evidence_organization_idx").on(table.organizationId),
  ],
);

// A persisted, scored candidate for improving an existing page. `dedupeKey`
// identifies the SAME opportunity across re-detection runs (organization +
// project + detector + subject — deliberately WITHOUT the observation window,
// unlike evidence's dedupe key, so a daily re-run updates one row instead of
// creating a new one every day).
export const trendbriefOpportunities = sqliteTable(
  "trendbrief_opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    detectorId: text("detector_id").notNull(),
    detectorVersion: text("detector_version").notNull(),
    type: text("type", { enum: ["improve_existing_page"] }).notNull(),
    subjectUrl: text("subject_url").notNull(),
    subjectQuery: text("subject_query").notNull(),
    status: text("status", {
      enum: [
        "detected",
        "accepted",
        "rejected",
        "completed",
        "measuring",
        "successful",
        "inconclusive",
        "unsuccessful",
        "expired",
        "superseded",
      ],
    })
      .notNull()
      .default("detected"),
    impactScore: real("impact_score").notNull(),
    effortScore: real("effort_score").notNull(),
    confidenceScore: real("confidence_score").notNull(),
    priorityScore: real("priority_score").notNull(),
    // JSON array of string codes, e.g. ["striking_distance","meaningful_impressions"].
    rationaleCodes: text("rationale_codes").notNull(),
    relevanceStatus: text("relevance_status", {
      enum: ["confirmed", "unconfirmed"],
    }).notNull(),
    firstDetectedAt: text("first_detected_at").notNull(),
    lastDetectedAt: text("last_detected_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_opportunities_dedupe_idx").on(table.dedupeKey),
    index("trendbrief_opportunities_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    index("trendbrief_opportunities_organization_idx").on(
      table.organizationId,
    ),
  ],
);

// Many-to-many: which exact evidence rows produced/support an opportunity.
export const trendbriefOpportunityEvidence = sqliteTable(
  "trendbrief_opportunity_evidence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => trendbriefEvidence.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("trendbrief_opportunity_evidence_unique_idx").on(
      table.opportunityId,
      table.evidenceId,
    ),
    index("trendbrief_opportunity_evidence_evidence_idx").on(
      table.evidenceId,
    ),
  ],
);

// One current deterministic recommendation per opportunity. `version` bumps
// on regeneration (e.g. a future AI-enrichment pass would bump it further;
// generationMethod stays "deterministic" for every row this slice writes).
export const trendbriefRecommendations = sqliteTable(
  "trendbrief_recommendations",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    recommendationType: text("recommendation_type", {
      enum: ["improve_existing_page"],
    }).notNull(),
    generationMethod: text("generation_method", {
      enum: ["deterministic", "llm"],
    }).notNull(),
    // JSON: {page, reasonCodes: string[], suggestedNextAnalysis: string[]}.
    proposedAction: text("proposed_action").notNull(),
    groundedSummary: text("grounded_summary").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_recommendations_opportunity_idx").on(
      table.opportunityId,
    ),
    index("trendbrief_recommendations_project_idx").on(table.projectId),
  ],
);

// Append/update log of what the operator did. One row per opportunity in
// TB-001 (updated in place as accept -> complete progresses); `actionType`
// holds the most recent action, `status` the coarse lifecycle bucket.
export const trendbriefActions = sqliteTable(
  "trendbrief_actions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    actionType: text("action_type", {
      enum: ["accept", "reject", "complete"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "rejected", "completed"],
    }).notNull(),
    actor: text("actor").notNull(),
    notes: text("notes"),
    acceptedAt: text("accepted_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_actions_opportunity_idx").on(table.opportunityId),
    index("trendbrief_actions_project_idx").on(table.projectId),
  ],
);

// Baseline-vs-comparison measurement recorded after an action completes.
// `classification` is correlational language only — never a causal claim.
export const trendbriefOutcomes = sqliteTable(
  "trendbrief_outcomes",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    baselineWindowStart: text("baseline_window_start").notNull(),
    baselineWindowEnd: text("baseline_window_end").notNull(),
    comparisonWindowStart: text("comparison_window_start").notNull(),
    comparisonWindowEnd: text("comparison_window_end").notNull(),
    // JSON: {baseline: OutcomeMetrics, comparison: OutcomeMetrics}.
    measuredMetrics: text("measured_metrics").notNull(),
    classification: text("classification", {
      enum: ["improved", "unchanged", "declined", "inconclusive"],
    }).notNull(),
    confidenceScore: real("confidence_score").notNull(),
    attributionNote: text("attribution_note").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_outcomes_opportunity_comparison_idx").on(
      table.opportunityId,
      table.comparisonWindowEnd,
    ),
    index("trendbrief_outcomes_project_idx").on(table.projectId),
  ],
);
```

- [ ] **Step 2: Write the Postgres mirror**

```ts
// src/db/pg/trendbrief.schema.ts
import { sql } from "drizzle-orm";
import { index, integer, pgTable, real, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const trendbriefEvidence = pgTable(
  "trendbrief_evidence",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["gsc"] }).notNull(),
    evidenceType: text("evidence_type", {
      enum: ["gsc_page_query_performance"],
    }).notNull(),
    subjectUrl: text("subject_url").notNull(),
    subjectQuery: text("subject_query"),
    observationStart: text("observation_start").notNull(),
    observationEnd: text("observation_end").notNull(),
    dataState: text("data_state", { enum: ["all", "final"] }).notNull(),
    metrics: text("metrics").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    capturedAt: text("captured_at").notNull().default(isoNow),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("trendbrief_evidence_dedupe_idx").on(table.dedupeKey),
    index("trendbrief_evidence_project_idx").on(
      table.projectId,
      table.capturedAt,
    ),
    index("trendbrief_evidence_organization_idx").on(table.organizationId),
  ],
);

export const trendbriefOpportunities = pgTable(
  "trendbrief_opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    detectorId: text("detector_id").notNull(),
    detectorVersion: text("detector_version").notNull(),
    type: text("type", { enum: ["improve_existing_page"] }).notNull(),
    subjectUrl: text("subject_url").notNull(),
    subjectQuery: text("subject_query").notNull(),
    status: text("status", {
      enum: [
        "detected",
        "accepted",
        "rejected",
        "completed",
        "measuring",
        "successful",
        "inconclusive",
        "unsuccessful",
        "expired",
        "superseded",
      ],
    })
      .notNull()
      .default("detected"),
    impactScore: real("impact_score").notNull(),
    effortScore: real("effort_score").notNull(),
    confidenceScore: real("confidence_score").notNull(),
    priorityScore: real("priority_score").notNull(),
    rationaleCodes: text("rationale_codes").notNull(),
    relevanceStatus: text("relevance_status", {
      enum: ["confirmed", "unconfirmed"],
    }).notNull(),
    firstDetectedAt: text("first_detected_at").notNull(),
    lastDetectedAt: text("last_detected_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_opportunities_dedupe_idx").on(table.dedupeKey),
    index("trendbrief_opportunities_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    index("trendbrief_opportunities_organization_idx").on(
      table.organizationId,
    ),
  ],
);

export const trendbriefOpportunityEvidence = pgTable(
  "trendbrief_opportunity_evidence",
  {
    id: serial("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => trendbriefEvidence.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("trendbrief_opportunity_evidence_unique_idx").on(
      table.opportunityId,
      table.evidenceId,
    ),
    index("trendbrief_opportunity_evidence_evidence_idx").on(
      table.evidenceId,
    ),
  ],
);

export const trendbriefRecommendations = pgTable(
  "trendbrief_recommendations",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    recommendationType: text("recommendation_type", {
      enum: ["improve_existing_page"],
    }).notNull(),
    generationMethod: text("generation_method", {
      enum: ["deterministic", "llm"],
    }).notNull(),
    proposedAction: text("proposed_action").notNull(),
    groundedSummary: text("grounded_summary").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_recommendations_opportunity_idx").on(
      table.opportunityId,
    ),
    index("trendbrief_recommendations_project_idx").on(table.projectId),
  ],
);

export const trendbriefActions = pgTable(
  "trendbrief_actions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    actionType: text("action_type", {
      enum: ["accept", "reject", "complete"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "rejected", "completed"],
    }).notNull(),
    actor: text("actor").notNull(),
    notes: text("notes"),
    acceptedAt: text("accepted_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_actions_opportunity_idx").on(table.opportunityId),
    index("trendbrief_actions_project_idx").on(table.projectId),
  ],
);

export const trendbriefOutcomes = pgTable(
  "trendbrief_outcomes",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => trendbriefOpportunities.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    baselineWindowStart: text("baseline_window_start").notNull(),
    baselineWindowEnd: text("baseline_window_end").notNull(),
    comparisonWindowStart: text("comparison_window_start").notNull(),
    comparisonWindowEnd: text("comparison_window_end").notNull(),
    measuredMetrics: text("measured_metrics").notNull(),
    classification: text("classification", {
      enum: ["improved", "unchanged", "declined", "inconclusive"],
    }).notNull(),
    confidenceScore: real("confidence_score").notNull(),
    attributionNote: text("attribution_note").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trendbrief_outcomes_opportunity_comparison_idx").on(
      table.opportunityId,
      table.comparisonWindowEnd,
    ),
    index("trendbrief_outcomes_project_idx").on(table.projectId),
  ],
);
```

- [ ] **Step 3: Register the new schema in all three barrels**

In `src/db/d1/schema.ts`, add one line: `export * from "../trendbrief.schema";`

In `src/db/pg/schema.ts`, add one line: `export * from "./trendbrief.schema";`

In `src/db/schema.ts`: add `import * as sqliteTrendbrief from "./trendbrief.schema";` and `import * as pgTrendbrief from "./pg/trendbrief.schema";` next to the other `sqliteGsc`/`pgGsc` imports; add `typeof sqliteTrendbrief` to the `AppSchema` intersection type; spread `...pgTrendbrief`/`...sqliteTrendbrief` into both branches of `runtimeSchema`; and add `trendbriefEvidence, trendbriefOpportunities, trendbriefOpportunityEvidence, trendbriefRecommendations, trendbriefActions, trendbriefOutcomes,` to the final destructured export list.

- [ ] **Step 4: Register the new tables in the schema-parity test**

In `src/db/schema-parity.test.ts`, add the same two imports (`sqliteTrendbrief`, `pgTrendbrief`) and append them to the `tablesFrom(...)` argument lists for both `sqliteAppTables` and `pgAppTables`.

- [ ] **Step 5: Generate migrations for both dialects**

Run: `npm run db:generate:d1`
Expected: a new file appears under `drizzle/`, containing `CREATE TABLE` statements for all six `trendbrief_*` tables plus their indexes.

Run: `npm run db:generate:pg`
Expected: a new file appears under `drizzle-pg/`, containing the Postgres equivalent.

- [ ] **Step 6: Run the schema-parity test**

Run: `npx vitest run src/db/schema-parity.test.ts`
Expected: PASS — all six new tables report matching columns, primary keys, unique constraints, and foreign keys across dialects.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from the new schema files or barrel edits).

- [ ] **Step 8: Commit**

```bash
git add src/db/trendbrief.schema.ts src/db/pg/trendbrief.schema.ts src/db/schema.ts src/db/d1/schema.ts src/db/pg/schema.ts src/db/schema-parity.test.ts drizzle/ drizzle-pg/
git commit -m "feat(trendbrief): add evidence/opportunity/recommendation/action/outcome schema"
```

---

### Task 2: Domain types and dedupe-key helpers

**Files:**
- Create: `src/server/features/trendbrief/domain/types.ts`
- Create: `src/server/features/trendbrief/domain/dedupeKeys.ts`
- Test: `src/server/features/trendbrief/domain/dedupeKeys.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain layer).
- Produces: `TrendbriefEvidenceSource`, `TrendbriefEvidenceType`, `GscEvidenceMetrics`, `TrendbriefOpportunityStatus`, `TrendbriefRelevanceStatus`, `TrendbriefActionType`, `TrendbriefOutcomeClassification`, `GSC_STRIKING_DISTANCE_DETECTOR_ID`, `GSC_STRIKING_DISTANCE_DETECTOR_VERSION`, `GSC_STRIKING_DISTANCE_DETECTOR_KEY` (consumed by every later task), `computeEvidenceDedupeKey(...)`, `computeOpportunityDedupeKey(...)` (consumed by Tasks 7 and 10).

- [ ] **Step 1: Write the domain types**

```ts
// src/server/features/trendbrief/domain/types.ts
export const TRENDBRIEF_EVIDENCE_SOURCES = ["gsc"] as const;
export type TrendbriefEvidenceSource = (typeof TRENDBRIEF_EVIDENCE_SOURCES)[number];

export const TRENDBRIEF_EVIDENCE_TYPES = ["gsc_page_query_performance"] as const;
export type TrendbriefEvidenceType = (typeof TRENDBRIEF_EVIDENCE_TYPES)[number];

export type GscEvidenceMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export const TRENDBRIEF_OPPORTUNITY_STATUSES = [
  "detected",
  "accepted",
  "rejected",
  "completed",
  "measuring",
  "successful",
  "inconclusive",
  "unsuccessful",
  "expired",
  "superseded",
] as const;
export type TrendbriefOpportunityStatus =
  (typeof TRENDBRIEF_OPPORTUNITY_STATUSES)[number];

export const TRENDBRIEF_RELEVANCE_STATUSES = ["confirmed", "unconfirmed"] as const;
export type TrendbriefRelevanceStatus =
  (typeof TRENDBRIEF_RELEVANCE_STATUSES)[number];

export const TRENDBRIEF_ACTION_TYPES = ["accept", "reject", "complete"] as const;
export type TrendbriefActionType = (typeof TRENDBRIEF_ACTION_TYPES)[number];

export const TRENDBRIEF_OUTCOME_CLASSIFICATIONS = [
  "improved",
  "unchanged",
  "declined",
  "inconclusive",
] as const;
export type TrendbriefOutcomeClassification =
  (typeof TRENDBRIEF_OUTCOME_CLASSIFICATIONS)[number];

// Stable detector identity — persisted on every opportunity row so a future
// scoring change can be distinguished from a past decision. Bump VERSION (not
// ID) when the detection/scoring rules change; bump ID for a genuinely new
// detector.
export const GSC_STRIKING_DISTANCE_DETECTOR_ID = "gsc-striking-distance";
export const GSC_STRIKING_DISTANCE_DETECTOR_VERSION = "v1";
export const GSC_STRIKING_DISTANCE_DETECTOR_KEY = `${GSC_STRIKING_DISTANCE_DETECTOR_ID}:${GSC_STRIKING_DISTANCE_DETECTOR_VERSION}`;
```

- [ ] **Step 2: Write the failing tests for dedupe-key helpers**

```ts
// src/server/features/trendbrief/domain/dedupeKeys.test.ts
import { describe, expect, it } from "vitest";
import { computeEvidenceDedupeKey, computeOpportunityDedupeKey } from "./dedupeKeys";

describe("computeEvidenceDedupeKey", () => {
  it("is stable for identical inputs", () => {
    const input = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };
    expect(computeEvidenceDedupeKey(input)).toBe(computeEvidenceDedupeKey(input));
  });

  it("differs when the observation window differs (a new window is new evidence)", () => {
    const base = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
    };
    const a = computeEvidenceDedupeKey({ ...base, observationStart: "2026-08-01", observationEnd: "2026-08-28" });
    const b = computeEvidenceDedupeKey({ ...base, observationStart: "2026-08-02", observationEnd: "2026-08-29" });
    expect(a).not.toBe(b);
  });

  it("treats a null subjectQuery distinctly from an empty string", () => {
    const base = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/page",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };
    const withNull = computeEvidenceDedupeKey({ ...base, subjectQuery: null });
    const withEmpty = computeEvidenceDedupeKey({ ...base, subjectQuery: "" });
    expect(withNull).toBe(withEmpty);
  });
});

describe("computeOpportunityDedupeKey", () => {
  it("is stable across re-detection regardless of observation window", () => {
    const input = {
      organizationId: "org_1",
      projectId: "project_1",
      detectorKey: "gsc-striking-distance:v1",
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
    };
    expect(computeOpportunityDedupeKey(input)).toBe(computeOpportunityDedupeKey(input));
  });

  it("differs for a different detector version (old opportunities aren't silently merged into a new detector's identity)", () => {
    const base = {
      organizationId: "org_1",
      projectId: "project_1",
      subjectUrl: "/page",
      subjectQuery: "query",
    };
    const v1 = computeOpportunityDedupeKey({ ...base, detectorKey: "gsc-striking-distance:v1" });
    const v2 = computeOpportunityDedupeKey({ ...base, detectorKey: "gsc-striking-distance:v2" });
    expect(v1).not.toBe(v2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/domain/dedupeKeys.test.ts`
Expected: FAIL with "Cannot find module './dedupeKeys'"

- [ ] **Step 4: Implement the dedupe-key helpers**

```ts
// src/server/features/trendbrief/domain/dedupeKeys.ts
import type { TrendbriefEvidenceSource, TrendbriefEvidenceType } from "./types";

export function computeEvidenceDedupeKey(input: {
  organizationId: string;
  projectId: string;
  source: TrendbriefEvidenceSource;
  evidenceType: TrendbriefEvidenceType;
  subjectUrl: string;
  subjectQuery: string | null;
  observationStart: string;
  observationEnd: string;
}): string {
  return [
    input.organizationId,
    input.projectId,
    input.source,
    input.evidenceType,
    input.subjectUrl,
    input.subjectQuery ?? "",
    input.observationStart,
    input.observationEnd,
  ].join("::");
}

// Deliberately excludes the observation window: the SAME opportunity must be
// updated (not duplicated) every time the detector re-runs, however often the
// underlying evidence window shifts. See specs/0012 "Idempotency".
export function computeOpportunityDedupeKey(input: {
  organizationId: string;
  projectId: string;
  detectorKey: string;
  subjectUrl: string;
  subjectQuery: string | null;
}): string {
  return [
    input.organizationId,
    input.projectId,
    input.detectorKey,
    input.subjectUrl,
    input.subjectQuery ?? "",
  ].join("::");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/domain/dedupeKeys.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/server/features/trendbrief/domain
git commit -m "feat(trendbrief): add domain types and dedupe-key helpers"
```

---

### Task 3: Scoring constants and component-score functions

**Files:**
- Create: `src/server/features/trendbrief/scoring/constants.ts`
- Create: `src/server/features/trendbrief/scoring/util.ts`
- Create: `src/server/features/trendbrief/scoring/score.ts`
- Test: `src/server/features/trendbrief/scoring/score.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `STRIKING_DISTANCE_MIN_POSITION`, `STRIKING_DISTANCE_MAX_POSITION`, `MIN_MEANINGFUL_IMPRESSIONS`, `LOW_CTR_THRESHOLD`, `EFFORT_IMPROVE_EXISTING_PAGE`, `OPPORTUNITY_STALE_AFTER_DAYS` (consumed by Task 9's detector); `roundComponent(value)`, `daysBetween(isoDate, now)` (consumed by Task 4); `computeDemandScore(impressions)`, `computeReachabilityScore(position)`, `computePriorityScore(inputs)` (consumed by Task 9).

- [ ] **Step 1: Write the named constants**

```ts
// src/server/features/trendbrief/scoring/constants.ts

// Detection thresholds — the "striking distance" window. Matches the range
// already used by the existing SearchOpportunityService prototype
// (src/server/features/ga4/services/SearchOpportunityService.ts:163), reused
// here as an explicit, independently-named constant rather than an inline
// literal, per TB-001 scope: these are a starting default, not immutable
// product truth.
export const STRIKING_DISTANCE_MIN_POSITION = 4;
export const STRIKING_DISTANCE_MAX_POSITION = 20;

// A page/query with fewer impressions than this over the observation window
// is evidence, but not (yet) a meaningful opportunity signal on its own.
export const MIN_MEANINGFUL_IMPRESSIONS = 50;

// CTR below this is flagged with the "low_or_moderate_ctr" rationale code —
// a simple, named heuristic threshold, not a benchmarked industry figure.
export const LOW_CTR_THRESHOLD = 0.03;

// Confidence: how impressions map to a 0-1 sample-size component, and how
// evidence age maps to a 0-1 freshness component.
export const SAMPLE_SIZE_CONFIDENCE_CEILING = 500;
export const EVIDENCE_FRESHNESS_FULL_CONFIDENCE_DAYS = 5;
export const EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS = 30;

export const CONFIDENCE_WEIGHT_FRESHNESS = 0.3;
export const CONFIDENCE_WEIGHT_SAMPLE_SIZE = 0.3;
export const CONFIDENCE_WEIGHT_RELEVANCE = 0.3;
export const CONFIDENCE_WEIGHT_AGREEMENT = 0.1;

export const CONFIDENCE_HIGH_THRESHOLD = 0.7;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.4;

// A rough, undifferentiated heuristic: improving an existing indexed page is
// assumed lower-effort than producing new content. TB-001 has no per-page
// effort measurement, so every candidate gets this same constant — documented
// as a known simplification in specs/0012, not a measured value.
export const EFFORT_IMPROVE_EXISTING_PAGE = 0.2;

// An opportunity not re-detected for this many days from its last detection
// is a candidate for a future "expired" transition. TB-001 only stores
// `expiresAt`; it does not implement the automatic transition (see specs/0012
// "Deviations" — `expired`/`superseded` are modeled but unused this slice).
export const OPPORTUNITY_STALE_AFTER_DAYS = 30;

// Outcome classification: minimum position improvement (in ranking spots) to
// call a comparison window "improved" rather than "unchanged".
export const OUTCOME_IMPROVEMENT_POSITION_THRESHOLD = 1;
```

- [ ] **Step 2: Write small numeric helpers**

```ts
// src/server/features/trendbrief/scoring/util.ts

// Rounds a 0-1 component score to 4 decimal places — mirrors
// SearchOpportunityService's roundComponent (SearchOpportunityService.ts:96)
// so component scores stay stable and comparable across runs.
export function roundComponent(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// Whole days between an ISO "YYYY-MM-DD" (or full ISO timestamp) date string
// and `now`, floor-rounded, never negative.
export function daysBetween(isoDate: string, now: Date): number {
  const then = new Date(isoDate).getTime();
  const diffMs = now.getTime() - then;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}
```

- [ ] **Step 3: Write the failing tests for component scores**

```ts
// src/server/features/trendbrief/scoring/score.test.ts
import { describe, expect, it } from "vitest";
import {
  computeDemandScore,
  computeReachabilityScore,
  computePriorityScore,
} from "./score";
import { STRIKING_DISTANCE_MIN_POSITION, STRIKING_DISTANCE_MAX_POSITION } from "./constants";

describe("computeDemandScore", () => {
  it("is 0 for zero impressions", () => {
    expect(computeDemandScore(0)).toBe(0);
  });

  it("increases monotonically with impressions", () => {
    const low = computeDemandScore(10);
    const mid = computeDemandScore(200);
    const high = computeDemandScore(5_000);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it("never exceeds 1", () => {
    expect(computeDemandScore(1_000_000)).toBeLessThanOrEqual(1);
  });
});

describe("computeReachabilityScore", () => {
  it("is highest at the closest-to-page-1 boundary of the striking-distance range", () => {
    expect(computeReachabilityScore(STRIKING_DISTANCE_MIN_POSITION)).toBe(1);
  });

  it("is lowest at the farthest boundary of the striking-distance range", () => {
    expect(computeReachabilityScore(STRIKING_DISTANCE_MAX_POSITION)).toBe(0);
  });

  it("decreases monotonically as position worsens", () => {
    const close = computeReachabilityScore(6);
    const far = computeReachabilityScore(18);
    expect(close).toBeGreaterThan(far);
  });
});

describe("computePriorityScore", () => {
  it("is deterministic for identical inputs", () => {
    const inputs = { demand: 0.8, reachability: 0.6, businessRelevance: 1, confidence: 0.9, effort: 0.2 };
    expect(computePriorityScore(inputs)).toBe(computePriorityScore(inputs));
  });

  it("higher demand never produces a lower priority, all else equal", () => {
    const base = { demand: 0.3, reachability: 0.5, businessRelevance: 1, confidence: 0.8, effort: 0.2 };
    const higherDemand = { ...base, demand: 0.9 };
    expect(computePriorityScore(higherDemand)).toBeGreaterThanOrEqual(computePriorityScore(base));
  });

  it("higher confidence never produces a lower priority, all else equal", () => {
    const base = { demand: 0.5, reachability: 0.5, businessRelevance: 1, confidence: 0.3, effort: 0.2 };
    const higherConfidence = { ...base, confidence: 0.9 };
    expect(computePriorityScore(higherConfidence)).toBeGreaterThanOrEqual(computePriorityScore(base));
  });

  it("higher effort never produces a higher priority, all else equal", () => {
    const base = { demand: 0.5, reachability: 0.5, businessRelevance: 1, confidence: 0.8, effort: 0.1 };
    const higherEffort = { ...base, effort: 0.6 };
    expect(computePriorityScore(higherEffort)).toBeLessThanOrEqual(computePriorityScore(base));
  });

  it("is 0 when any multiplicative component is 0", () => {
    expect(computePriorityScore({ demand: 0, reachability: 0.9, businessRelevance: 1, confidence: 0.9, effort: 0.1 })).toBe(0);
  });

  it("is at most 100", () => {
    expect(computePriorityScore({ demand: 1, reachability: 1, businessRelevance: 1, confidence: 1, effort: 0 })).toBe(100);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/scoring/score.test.ts`
Expected: FAIL with "Cannot find module './score'"

- [ ] **Step 5: Implement the component-score functions**

```ts
// src/server/features/trendbrief/scoring/score.ts
import {
  STRIKING_DISTANCE_MIN_POSITION,
  STRIKING_DISTANCE_MAX_POSITION,
  SAMPLE_SIZE_CONFIDENCE_CEILING,
} from "./constants";
import { roundComponent } from "./util";

export type PriorityInputs = {
  demand: number;
  reachability: number;
  businessRelevance: number;
  confidence: number;
  effort: number;
};

// Log-dampened demand, 0-1, so one huge outlier page doesn't collapse every
// other candidate toward 0. Same log1p shape as SearchOpportunityService's
// demand component (SearchOpportunityService.ts:210-212), but expressed as an
// independently-clamped 0-1 score (not a percentile-rank across the batch),
// so a single candidate can be scored in isolation.
export function computeDemandScore(impressions: number): number {
  const ceiling = Math.log1p(SAMPLE_SIZE_CONFIDENCE_CEILING);
  return roundComponent(
    Math.min(1, Math.log1p(Math.max(impressions, 0)) / ceiling),
  );
}

// Linear 0-1 across the striking-distance range: position 4 (closest to page
// 1) scores 1, position 20 (farthest) scores 0.
export function computeReachabilityScore(position: number): number {
  const span = STRIKING_DISTANCE_MAX_POSITION - STRIKING_DISTANCE_MIN_POSITION;
  const clamped = Math.min(
    Math.max(position, STRIKING_DISTANCE_MIN_POSITION),
    STRIKING_DISTANCE_MAX_POSITION,
  );
  return roundComponent(
    (STRIKING_DISTANCE_MAX_POSITION - clamped) / span,
  );
}

// priority = demand x reachability x business_relevance x confidence,
// adjusted down by effort — every factor is independently visible on the
// persisted opportunity row (impactScore=demand, confidenceScore, etc.), so
// this is inspectable, not a black box. Rounded to a 0-100 integer to match
// the existing SearchOpportunityService scoring convention.
export function computePriorityScore(inputs: PriorityInputs): number {
  const raw =
    inputs.demand *
    inputs.reachability *
    inputs.businessRelevance *
    inputs.confidence *
    (1 - inputs.effort);
  return Math.round(raw * 100);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/scoring/score.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 7: Commit**

```bash
git add src/server/features/trendbrief/scoring/constants.ts src/server/features/trendbrief/scoring/util.ts src/server/features/trendbrief/scoring/score.ts src/server/features/trendbrief/scoring/score.test.ts
git commit -m "feat(trendbrief): add scoring constants and component-score functions"
```

---

### Task 4: Confidence scoring

**Files:**
- Create: `src/server/features/trendbrief/scoring/confidence.ts`
- Test: `src/server/features/trendbrief/scoring/confidence.test.ts`

**Interfaces:**
- Consumes: `roundComponent`, `daysBetween` from `./util` (Task 3); `CONFIDENCE_WEIGHT_*`, `CONFIDENCE_HIGH_THRESHOLD`, `CONFIDENCE_MEDIUM_THRESHOLD`, `SAMPLE_SIZE_CONFIDENCE_CEILING`, `EVIDENCE_FRESHNESS_FULL_CONFIDENCE_DAYS`, `EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS` from `./constants` (Task 3); `TrendbriefRelevanceStatus` from `../domain/types` (Task 2).
- Produces: `computeConfidenceScore(inputs, now?)`, `confidenceLabel(score)` (consumed by Task 9's detector).

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/features/trendbrief/scoring/confidence.test.ts
import { describe, expect, it } from "vitest";
import { computeConfidenceScore, confidenceLabel } from "./confidence";

const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("computeConfidenceScore", () => {
  it("is highest for fresh evidence, a large sample, and confirmed relevance", () => {
    const score = computeConfidenceScore(
      {
        observationEndDate: "2026-08-30",
        impressions: 5_000,
        relevanceStatus: "confirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    expect(score).toBeGreaterThan(0.8);
  });

  it("is lower for stale evidence than for fresh evidence, all else equal", () => {
    const fresh = computeConfidenceScore(
      { observationEndDate: "2026-08-30", impressions: 200, relevanceStatus: "confirmed", evidenceSourceCount: 1 },
      NOW,
    );
    const stale = computeConfidenceScore(
      { observationEndDate: "2026-07-01", impressions: 200, relevanceStatus: "confirmed", evidenceSourceCount: 1 },
      NOW,
    );
    expect(stale).toBeLessThan(fresh);
  });

  it("is lower for a small impression sample than a large one, all else equal", () => {
    const small = computeConfidenceScore(
      { observationEndDate: "2026-08-30", impressions: 5, relevanceStatus: "confirmed", evidenceSourceCount: 1 },
      NOW,
    );
    const large = computeConfidenceScore(
      { observationEndDate: "2026-08-30", impressions: 5_000, relevanceStatus: "confirmed", evidenceSourceCount: 1 },
      NOW,
    );
    expect(small).toBeLessThan(large);
  });

  it("is lower when commercial relevance is unconfirmed than when confirmed, all else equal", () => {
    const unconfirmed = computeConfidenceScore(
      { observationEndDate: "2026-08-30", impressions: 500, relevanceStatus: "unconfirmed", evidenceSourceCount: 1 },
      NOW,
    );
    const confirmed = computeConfidenceScore(
      { observationEndDate: "2026-08-30", impressions: 500, relevanceStatus: "confirmed", evidenceSourceCount: 1 },
      NOW,
    );
    expect(unconfirmed).toBeLessThan(confirmed);
  });

  it("stays within 0 and 1", () => {
    const score = computeConfidenceScore(
      { observationEndDate: "2020-01-01", impressions: 0, relevanceStatus: "unconfirmed", evidenceSourceCount: 1 },
      NOW,
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("confidenceLabel", () => {
  it("maps >= 0.7 to high, >= 0.4 to medium, and below that to low", () => {
    expect(confidenceLabel(0.9)).toBe("high");
    expect(confidenceLabel(0.7)).toBe("high");
    expect(confidenceLabel(0.5)).toBe("medium");
    expect(confidenceLabel(0.4)).toBe("medium");
    expect(confidenceLabel(0.1)).toBe("low");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/scoring/confidence.test.ts`
Expected: FAIL with "Cannot find module './confidence'"

- [ ] **Step 3: Implement confidence scoring**

```ts
// src/server/features/trendbrief/scoring/confidence.ts
import type { TrendbriefRelevanceStatus } from "../domain/types";
import {
  CONFIDENCE_HIGH_THRESHOLD,
  CONFIDENCE_MEDIUM_THRESHOLD,
  CONFIDENCE_WEIGHT_AGREEMENT,
  CONFIDENCE_WEIGHT_FRESHNESS,
  CONFIDENCE_WEIGHT_RELEVANCE,
  CONFIDENCE_WEIGHT_SAMPLE_SIZE,
  EVIDENCE_FRESHNESS_FULL_CONFIDENCE_DAYS,
  EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS,
  SAMPLE_SIZE_CONFIDENCE_CEILING,
} from "./constants";
import { daysBetween, roundComponent } from "./util";

export type ConfidenceInputs = {
  observationEndDate: string;
  impressions: number;
  relevanceStatus: TrendbriefRelevanceStatus;
  // Number of independent evidence sources that agree on this candidate.
  // TB-001 only ever collects GSC evidence, so this is always 1; the
  // component is a placeholder for when a second source (e.g. GA4) is added
  // to evidence collection — see specs/0012 "Deviations".
  evidenceSourceCount: number;
};

function computeFreshnessScore(observationEndDate: string, now: Date): number {
  const ageDays = daysBetween(observationEndDate, now);
  if (ageDays <= EVIDENCE_FRESHNESS_FULL_CONFIDENCE_DAYS) return 1;
  if (ageDays >= EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS) return 0;
  const span =
    EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS -
    EVIDENCE_FRESHNESS_FULL_CONFIDENCE_DAYS;
  return roundComponent(
    (EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS - ageDays) / span,
  );
}

function computeSampleSizeScore(impressions: number): number {
  return roundComponent(
    Math.min(1, Math.max(impressions, 0) / SAMPLE_SIZE_CONFIDENCE_CEILING),
  );
}

// Unconfirmed relevance is a moderate prior (0.5), not zero: most GSC-ranking
// pages on a project's own domain are plausibly relevant even without an
// explicit key-page match. This is a deliberate, documented simplification —
// see specs/0012 "Commercial relevance limitations".
function computeRelevanceComponent(status: TrendbriefRelevanceStatus): number {
  return status === "confirmed" ? 1 : 0.5;
}

function computeAgreementScore(evidenceSourceCount: number): number {
  return evidenceSourceCount > 1 ? 1 : 0.5;
}

export function computeConfidenceScore(
  inputs: ConfidenceInputs,
  now: Date = new Date(),
): number {
  const freshness = computeFreshnessScore(inputs.observationEndDate, now);
  const sampleSize = computeSampleSizeScore(inputs.impressions);
  const relevance = computeRelevanceComponent(inputs.relevanceStatus);
  const agreement = computeAgreementScore(inputs.evidenceSourceCount);
  return roundComponent(
    freshness * CONFIDENCE_WEIGHT_FRESHNESS +
      sampleSize * CONFIDENCE_WEIGHT_SAMPLE_SIZE +
      relevance * CONFIDENCE_WEIGHT_RELEVANCE +
      agreement * CONFIDENCE_WEIGHT_AGREEMENT,
  );
}

export function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= CONFIDENCE_HIGH_THRESHOLD) return "high";
  if (score >= CONFIDENCE_MEDIUM_THRESHOLD) return "medium";
  return "low";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/scoring/confidence.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/features/trendbrief/scoring/confidence.ts src/server/features/trendbrief/scoring/confidence.test.ts
git commit -m "feat(trendbrief): add confidence scoring"
```

---

### Task 5: Commercial relevance matching (reuses existing project key pages)

**Files:**
- Create: `src/server/features/trendbrief/scoring/relevance.ts`
- Test: `src/server/features/trendbrief/scoring/relevance.test.ts`

**Interfaces:**
- Consumes: nothing new (the caller — Task 9's detector — supplies key-page rows already fetched via the existing `ProjectContextRepository.listKeyPages(projectId)`, `src/server/features/project-context/repositories/ProjectContextRepository.ts:151`; this module does not import the repository itself, keeping it a pure, independently-testable function).
- Produces: `matchCommercialRelevance(subjectUrl, keyPages)` returning `{status: TrendbriefRelevanceStatus, matchedRole, matchedTopic}` (consumed by Task 9).

This is TB-001's commercial-relevance mechanism: reuse the project's existing, human-curated `project_key_pages` list (role: hub/spoke/money/other) instead of building a new relevance model. **Limitation** (documented here and in specs/0012): a project with an empty or incomplete key-pages list will have every candidate's relevance marked `unconfirmed`, not `confirmed` — this is a false negative risk the brief explicitly permits ("mark the opportunity as requiring relevance confirmation rather than pretending certainty").

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/features/trendbrief/scoring/relevance.test.ts
import { describe, expect, it } from "vitest";
import { matchCommercialRelevance } from "./relevance";

const keyPages = [
  { url: "https://example.com/tree-removal-cheltenham", role: "money" as const, topic: "tree removal" },
  { url: "https://example.com/blog/pruning-tips", role: "spoke" as const, topic: "pruning" },
];

describe("matchCommercialRelevance", () => {
  it("confirms relevance when the subject URL matches a key page by path, ignoring host/scheme", () => {
    const result = matchCommercialRelevance("/tree-removal-cheltenham", keyPages);
    expect(result.status).toBe("confirmed");
    expect(result.matchedRole).toBe("money");
    expect(result.matchedTopic).toBe("tree removal");
  });

  it("confirms relevance when the subject URL has a trailing slash and the key page doesn't", () => {
    const result = matchCommercialRelevance("https://example.com/tree-removal-cheltenham/", keyPages);
    expect(result.status).toBe("confirmed");
  });

  it("leaves relevance unconfirmed (not rejected) when no key page matches", () => {
    const result = matchCommercialRelevance("/some-other-page", keyPages);
    expect(result.status).toBe("unconfirmed");
    expect(result.matchedRole).toBeNull();
  });

  it("leaves relevance unconfirmed when the project has no key pages at all", () => {
    const result = matchCommercialRelevance("/tree-removal-cheltenham", []);
    expect(result.status).toBe("unconfirmed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/scoring/relevance.test.ts`
Expected: FAIL with "Cannot find module './relevance'"

- [ ] **Step 3: Implement commercial relevance matching**

```ts
// src/server/features/trendbrief/scoring/relevance.ts
import type { TrendbriefRelevanceStatus } from "../domain/types";

export type KeyPageRole = "hub" | "spoke" | "money" | "other";

export type KeyPageForRelevance = {
  url: string;
  role: KeyPageRole | null;
  topic: string | null;
};

export type CommercialRelevanceMatch = {
  status: TrendbriefRelevanceStatus;
  matchedRole: KeyPageRole | null;
  matchedTopic: string | null;
};

function normalizePath(rawUrl: string): string {
  const withScheme = rawUrl.includes("://")
    ? rawUrl
    : `https://placeholder.invalid${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`;
  try {
    const parsed = new URL(withScheme);
    let path = parsed.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

export function matchCommercialRelevance(
  subjectUrl: string,
  keyPages: KeyPageForRelevance[],
): CommercialRelevanceMatch {
  const subjectPath = normalizePath(subjectUrl);
  const match = keyPages.find((page) => normalizePath(page.url) === subjectPath);
  if (!match) {
    return { status: "unconfirmed", matchedRole: null, matchedTopic: null };
  }
  return { status: "confirmed", matchedRole: match.role, matchedTopic: match.topic };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/scoring/relevance.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/features/trendbrief/scoring/relevance.ts src/server/features/trendbrief/scoring/relevance.test.ts
git commit -m "feat(trendbrief): add commercial relevance matching via project key pages"
```

---

### Task 6: Evidence repository

**Files:**
- Create: `src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.ts`
- Test: `src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.test.ts`

**Interfaces:**
- Consumes: `trendbriefEvidence` table from `@/db/schema` (Task 1); `TrendbriefEvidenceSource`, `TrendbriefEvidenceType`, `GscEvidenceMetrics` from `../domain/types` (Task 2).
- Produces: `TrendbriefEvidence` type, `TrendbriefEvidenceRepository.upsert(input)`, `TrendbriefEvidenceRepository.listByIds(ids)` (both consumed by Task 7's collector and Task 8's detector-orchestration).

Every write and read here is already scoped by construction: `upsert` always carries the caller's `organizationId`/`projectId` (never inferred from the row being written), and reads take an explicit `projectId` filter — mirroring `GscConnectionRepository` (`src/server/features/gsc/repositories/GscConnectionRepository.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefEvidenceRepository } from "./TrendbriefEvidenceRepository";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { insert: mocks.insert, select: mocks.select } }));

describe("TrendbriefEvidenceRepository.upsert", () => {
  beforeEach(() => {
    mocks.insert.mockReset();
    const builder = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: "evidence_1", dedupeKey: "key_1" }]),
    };
    builder.values.mockReturnValue(builder);
    builder.onConflictDoUpdate.mockReturnValue(builder);
    mocks.insert.mockReturnValue(builder);
  });

  it("inserts with the caller-supplied organizationId/projectId and an onConflict target on dedupeKey", async () => {
    const row = await TrendbriefEvidenceRepository.upsert({
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc",
      evidenceType: "gsc_page_query_performance",
      subjectUrl: "/page",
      subjectQuery: "query",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
      dataState: "final",
      metrics: { clicks: 10, impressions: 200, ctr: 0.05, position: 8 },
      dedupeKey: "key_1",
    });

    expect(row.id).toBe("evidence_1");
    const insertedValues = mocks.insert.mock.results[0]!.value.values.mock.calls[0][0];
    expect(insertedValues.organizationId).toBe("org_1");
    expect(insertedValues.projectId).toBe("project_1");
    expect(insertedValues.dedupeKey).toBe("key_1");
    expect(JSON.parse(insertedValues.metrics)).toEqual({
      clicks: 10,
      impressions: 200,
      ctr: 0.05,
      position: 8,
    });
    const conflictArgs = mocks.insert.mock.results[0]!.value.onConflictDoUpdate.mock.calls[0][0];
    expect(conflictArgs.target).toBeDefined();
  });
});

describe("TrendbriefEvidenceRepository.listByIds", () => {
  it("returns an empty array without querying when given no ids", async () => {
    mocks.select.mockReset();
    const rows = await TrendbriefEvidenceRepository.listByIds([]);
    expect(rows).toEqual([]);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefEvidenceRepository'"

- [ ] **Step 3: Implement the repository**

```ts
// src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.ts
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefEvidence } from "@/db/schema";
import type {
  GscEvidenceMetrics,
  TrendbriefEvidenceSource,
  TrendbriefEvidenceType,
} from "../domain/types";

export type TrendbriefEvidence = typeof trendbriefEvidence.$inferSelect;

async function upsert(input: {
  organizationId: string;
  projectId: string;
  source: TrendbriefEvidenceSource;
  evidenceType: TrendbriefEvidenceType;
  subjectUrl: string;
  subjectQuery: string | null;
  observationStart: string;
  observationEnd: string;
  dataState: "all" | "final";
  metrics: GscEvidenceMetrics;
  dedupeKey: string;
}): Promise<TrendbriefEvidence> {
  const nowIso = new Date().toISOString();
  const [row] = await db
    .insert(trendbriefEvidence)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      source: input.source,
      evidenceType: input.evidenceType,
      subjectUrl: input.subjectUrl,
      subjectQuery: input.subjectQuery,
      observationStart: input.observationStart,
      observationEnd: input.observationEnd,
      dataState: input.dataState,
      metrics: JSON.stringify(input.metrics),
      dedupeKey: input.dedupeKey,
      capturedAt: nowIso,
      createdAt: nowIso,
    })
    .onConflictDoUpdate({
      target: trendbriefEvidence.dedupeKey,
      set: {
        metrics: JSON.stringify(input.metrics),
        dataState: input.dataState,
        capturedAt: nowIso,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert trendbrief_evidence");
  return row;
}

async function listByIds(ids: string[]): Promise<TrendbriefEvidence[]> {
  if (ids.length === 0) return [];
  return db.select().from(trendbriefEvidence).where(inArray(trendbriefEvidence.id, ids));
}

export const TrendbriefEvidenceRepository = { upsert, listByIds };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.ts src/server/features/trendbrief/repositories/TrendbriefEvidenceRepository.test.ts
git commit -m "feat(trendbrief): add evidence repository"
```

---

### Task 7: GSC evidence collector service

**Files:**
- Create: `src/server/features/trendbrief/services/TrendbriefEvidenceCollector.ts`
- Test: `src/server/features/trendbrief/services/TrendbriefEvidenceCollector.test.ts`

**Interfaces:**
- Consumes: `GscService.getPerformance(input)` from `@/server/features/gsc/services/GscService` (existing, unmodified — request/response shapes at `src/server/lib/gscClient.ts:16-22,30-43`); `STRIKING_DISTANCE_MIN_POSITION`, `STRIKING_DISTANCE_MAX_POSITION` from `../scoring/constants` (Task 3); `computeEvidenceDedupeKey` from `../domain/dedupeKeys` (Task 2); `TrendbriefEvidenceRepository.upsert` from `../repositories/TrendbriefEvidenceRepository` (Task 6).
- Produces: `TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence(input)` returning `{observationStart, observationEnd, rowsConsidered, rowsInStrikingDistance, evidence: TrendbriefEvidence[]}` (consumed by Task 9's `TrendbriefAnalysisService`).

This is the "minimum adapter" the brief asks for: it calls the existing, already-project-scoped `GscService.getPerformance` (no new GSC integration code, no new paid calls — GSC is free), filters to the striking-distance position range, and persists ONLY the qualifying rows as evidence (not the full up-to-1000-row response), keeping evidence volume bounded.

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/features/trendbrief/services/TrendbriefEvidenceCollector.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefEvidenceCollector } from "./TrendbriefEvidenceCollector";

const mocks = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));
vi.mock("../repositories/TrendbriefEvidenceRepository", () => ({
  TrendbriefEvidenceRepository: { upsert: mocks.upsert },
}));

describe("TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence", () => {
  beforeEach(() => {
    mocks.getPerformance.mockReset();
    mocks.upsert.mockReset();
    mocks.upsert.mockImplementation(async (input) => ({
      id: `evidence_${input.subjectUrl}_${input.subjectQuery}`,
      ...input,
      metrics: JSON.stringify(input.metrics),
    }));
  });

  it("persists only rows within the striking-distance position range, with a page+query key", async () => {
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: "user@example.com",
      request: { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["page", "query"] },
      rows: [
        { keys: ["/page-a", "query a"], clicks: 5, impressions: 300, ctr: 0.017, position: 8 },
        { keys: ["/page-b", "query b"], clicks: 50, impressions: 900, ctr: 0.055, position: 2 },
        { keys: ["/page-c", "query c"], clicks: 1, impressions: 40, ctr: 0.025, position: 25 },
      ],
    });

    const result = await TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.rowsConsidered).toBe(3);
    expect(result.rowsInStrikingDistance).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const upsertInput = mocks.upsert.mock.calls[0][0];
    expect(upsertInput.subjectUrl).toBe("/page-a");
    expect(upsertInput.subjectQuery).toBe("query a");
    expect(upsertInput.organizationId).toBe("org_1");
    expect(upsertInput.projectId).toBe("project_1");
    expect(upsertInput.observationStart).toBe("2026-08-01");
    expect(upsertInput.observationEnd).toBe("2026-08-28");
  });

  it("skips a row with fewer than two dimension keys (no query dimension)", async () => {
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: null,
      request: { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["page", "query"] },
      rows: [{ keys: ["/page-only"], clicks: 1, impressions: 100, ctr: 0.01, position: 10 }],
    });

    const result = await TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.evidence).toHaveLength(0);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("calls GscService.getPerformance with the page+query dimensions and the project scope", async () => {
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: null,
      request: { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["page", "query"] },
      rows: [],
    });

    await TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence({
      organizationId: "org_1",
      projectId: "project_1",
      startDate: "2026-08-01",
      endDate: "2026-08-28",
    });

    expect(mocks.getPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        dimensions: ["page", "query"],
        startDate: "2026-08-01",
        endDate: "2026-08-28",
        type: "web",
        dataState: "final",
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefEvidenceCollector.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefEvidenceCollector'"

- [ ] **Step 3: Implement the collector**

```ts
// src/server/features/trendbrief/services/TrendbriefEvidenceCollector.ts
import { GscService } from "@/server/features/gsc/services/GscService";
import { computeEvidenceDedupeKey } from "../domain/dedupeKeys";
import type { GscEvidenceMetrics } from "../domain/types";
import {
  TrendbriefEvidenceRepository,
  type TrendbriefEvidence,
} from "../repositories/TrendbriefEvidenceRepository";
import {
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
} from "../scoring/constants";

export type CollectGscEvidenceInput = {
  organizationId: string;
  projectId: string;
  startDate?: string;
  endDate?: string;
};

export type CollectedEvidenceSummary = {
  observationStart: string;
  observationEnd: string;
  rowsConsidered: number;
  rowsInStrikingDistance: number;
  evidence: TrendbriefEvidence[];
};

async function collectGscStrikingDistanceEvidence(
  input: CollectGscEvidenceInput,
): Promise<CollectedEvidenceSummary> {
  const performance = await GscService.getPerformance({
    projectId: input.projectId,
    dimensions: ["page", "query"],
    startDate: input.startDate,
    endDate: input.endDate,
    rowLimit: 1_000,
    startRow: 0,
    type: "web",
    dataState: "final",
  });

  const qualifying = performance.rows.filter(
    (row) =>
      (row.keys?.length ?? 0) >= 2 &&
      row.position >= STRIKING_DISTANCE_MIN_POSITION &&
      row.position <= STRIKING_DISTANCE_MAX_POSITION,
  );

  const evidence: TrendbriefEvidence[] = [];
  for (const row of qualifying) {
    const subjectUrl = row.keys![0];
    const subjectQuery = row.keys![1];
    const metrics: GscEvidenceMetrics = {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };
    const dedupeKey = computeEvidenceDedupeKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      source: "gsc",
      evidenceType: "gsc_page_query_performance",
      subjectUrl,
      subjectQuery,
      observationStart: performance.request.startDate,
      observationEnd: performance.request.endDate,
    });
    const row_ = await TrendbriefEvidenceRepository.upsert({
      organizationId: input.organizationId,
      projectId: input.projectId,
      source: "gsc",
      evidenceType: "gsc_page_query_performance",
      subjectUrl,
      subjectQuery,
      observationStart: performance.request.startDate,
      observationEnd: performance.request.endDate,
      dataState: "final",
      metrics,
      dedupeKey,
    });
    evidence.push(row_);
  }

  return {
    observationStart: performance.request.startDate,
    observationEnd: performance.request.endDate,
    rowsConsidered: performance.rows.length,
    rowsInStrikingDistance: qualifying.length,
    evidence,
  };
}

export const TrendbriefEvidenceCollector = { collectGscStrikingDistanceEvidence };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefEvidenceCollector.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/features/trendbrief/services/TrendbriefEvidenceCollector.ts src/server/features/trendbrief/services/TrendbriefEvidenceCollector.test.ts
git commit -m "feat(trendbrief): add GSC evidence collector"
```

---

### Task 8: GSC striking-distance detector and deterministic recommendation builder

**Files:**
- Create: `src/server/features/trendbrief/detectors/gscStrikingDistanceDetector.ts`
- Test: `src/server/features/trendbrief/detectors/gscStrikingDistanceDetector.test.ts`
- Create: `src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.ts`
- Test: `src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.test.ts`

**Interfaces:**
- Consumes: `TrendbriefEvidence` from `../repositories/TrendbriefEvidenceRepository` (Task 6); `KeyPageForRelevance`, `matchCommercialRelevance` from `../scoring/relevance` (Task 5); `computeDemandScore`, `computeReachabilityScore`, `computePriorityScore` from `../scoring/score` (Task 3); `computeConfidenceScore` from `../scoring/confidence` (Task 4); `MIN_MEANINGFUL_IMPRESSIONS`, `LOW_CTR_THRESHOLD`, `EFFORT_IMPROVE_EXISTING_PAGE`, `STRIKING_DISTANCE_MIN_POSITION`, `STRIKING_DISTANCE_MAX_POSITION` from `../scoring/constants` (Task 3).
- Produces: `StrikingDistanceCandidate` type, `detectGscStrikingDistanceCandidates(input)` (consumed by Task 9); `buildDeterministicRecommendation(candidate)` (consumed by Task 9).

This is the **deterministic detector** the brief requires: a pure function over already-persisted evidence, no I/O, no LLM call, every threshold a named constant from Task 3.

- [ ] **Step 1: Write the failing detector tests**

```ts
// src/server/features/trendbrief/detectors/gscStrikingDistanceDetector.test.ts
import { describe, expect, it } from "vitest";
import { detectGscStrikingDistanceCandidates } from "./gscStrikingDistanceDetector";
import type { TrendbriefEvidence } from "../repositories/TrendbriefEvidenceRepository";

const NOW = new Date("2026-09-01T00:00:00.000Z");

function evidenceRow(overrides: Partial<TrendbriefEvidence> & { metrics?: object } = {}): TrendbriefEvidence {
  return {
    id: "evidence_1",
    organizationId: "org_1",
    projectId: "project_1",
    source: "gsc",
    evidenceType: "gsc_page_query_performance",
    subjectUrl: "/tree-removal-cheltenham",
    subjectQuery: "tree removal cheltenham",
    observationStart: "2026-08-01",
    observationEnd: "2026-08-28",
    dataState: "final",
    metrics: JSON.stringify({ clicks: 20, impressions: 400, ctr: 0.05, position: 8, ...overrides.metrics }),
    dedupeKey: "dedupe_1",
    capturedAt: "2026-08-28T00:00:00.000Z",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  } as TrendbriefEvidence;
}

describe("detectGscStrikingDistanceCandidates", () => {
  it("produces a candidate for a qualifying page/query in the striking-distance range with meaningful impressions", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow()],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.subjectUrl).toBe("/tree-removal-cheltenham");
    expect(candidates[0]!.subjectQuery).toBe("tree removal cheltenham");
    expect(candidates[0]!.rationaleCodes).toContain("striking_distance");
  });

  it("does not produce a candidate when position is outside the configured range", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ metrics: { position: 25 } })],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });

  it("does not produce a candidate when impressions are below the configured threshold", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ metrics: { impressions: 5 } })],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });

  it("produces a candidate with low confidence (not zero candidates) for stale evidence", () => {
    const fresh = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ observationEnd: "2026-08-28" })],
      keyPages: [],
      now: NOW,
    })[0]!;
    const stale = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ observationEnd: "2026-06-01" })],
      keyPages: [],
      now: NOW,
    })[0]!;
    expect(stale.scores.confidence).toBeLessThan(fresh.scores.confidence);
  });

  it("marks relevance confirmed and raises businessRelevance/priority when the page matches a key page", () => {
    const withoutKeyPage = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow()],
      keyPages: [],
      now: NOW,
    })[0]!;
    const withKeyPage = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow()],
      keyPages: [{ url: "/tree-removal-cheltenham", role: "money", topic: "tree removal" }],
      now: NOW,
    })[0]!;
    expect(withoutKeyPage.relevanceStatus).toBe("unconfirmed");
    expect(withKeyPage.relevanceStatus).toBe("confirmed");
    expect(withKeyPage.scores.priority).toBeGreaterThan(withoutKeyPage.scores.priority);
  });

  it("skips evidence with no subjectQuery", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ subjectQuery: null })],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/detectors/gscStrikingDistanceDetector.test.ts`
Expected: FAIL with "Cannot find module './gscStrikingDistanceDetector'"

- [ ] **Step 3: Implement the detector**

```ts
// src/server/features/trendbrief/detectors/gscStrikingDistanceDetector.ts
import type { TrendbriefRelevanceStatus, GscEvidenceMetrics } from "../domain/types";
import type { TrendbriefEvidence } from "../repositories/TrendbriefEvidenceRepository";
import { computeConfidenceScore } from "../scoring/confidence";
import {
  EFFORT_IMPROVE_EXISTING_PAGE,
  LOW_CTR_THRESHOLD,
  MIN_MEANINGFUL_IMPRESSIONS,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
} from "../scoring/constants";
import { matchCommercialRelevance, type KeyPageForRelevance } from "../scoring/relevance";
import { computeDemandScore, computePriorityScore, computeReachabilityScore } from "../scoring/score";

export type StrikingDistanceCandidate = {
  subjectUrl: string;
  subjectQuery: string;
  evidenceIds: string[];
  metrics: GscEvidenceMetrics;
  observationStart: string;
  observationEnd: string;
  relevanceStatus: TrendbriefRelevanceStatus;
  matchedKeyPageRole: string | null;
  scores: {
    demand: number;
    reachability: number;
    businessRelevance: number;
    confidence: number;
    effort: number;
    priority: number;
  };
  rationaleCodes: string[];
};

export function detectGscStrikingDistanceCandidates(input: {
  evidence: TrendbriefEvidence[];
  keyPages: KeyPageForRelevance[];
  now?: Date;
}): StrikingDistanceCandidate[] {
  const now = input.now ?? new Date();
  const candidates: StrikingDistanceCandidate[] = [];

  for (const row of input.evidence) {
    if (!row.subjectQuery) continue;
    const metrics = JSON.parse(row.metrics) as GscEvidenceMetrics;

    if (
      metrics.position < STRIKING_DISTANCE_MIN_POSITION ||
      metrics.position > STRIKING_DISTANCE_MAX_POSITION
    ) {
      continue;
    }
    if (metrics.impressions < MIN_MEANINGFUL_IMPRESSIONS) continue;

    const relevance = matchCommercialRelevance(row.subjectUrl, input.keyPages);
    const demand = computeDemandScore(metrics.impressions);
    const reachability = computeReachabilityScore(metrics.position);
    const businessRelevance = relevance.status === "confirmed" ? 1 : 0.5;
    const confidence = computeConfidenceScore(
      {
        observationEndDate: row.observationEnd,
        impressions: metrics.impressions,
        relevanceStatus: relevance.status,
        evidenceSourceCount: 1,
      },
      now,
    );
    const effort = EFFORT_IMPROVE_EXISTING_PAGE;
    const priority = computePriorityScore({ demand, reachability, businessRelevance, confidence, effort });

    const rationaleCodes = ["striking_distance", "meaningful_impressions"];
    rationaleCodes.push(metrics.ctr < LOW_CTR_THRESHOLD ? "low_or_moderate_ctr" : "healthy_ctr");
    rationaleCodes.push(
      relevance.status === "confirmed"
        ? `commercial_relevance_confirmed_${relevance.matchedRole ?? "key_page"}`
        : "relevance_unconfirmed",
    );

    candidates.push({
      subjectUrl: row.subjectUrl,
      subjectQuery: row.subjectQuery,
      evidenceIds: [row.id],
      metrics,
      observationStart: row.observationStart,
      observationEnd: row.observationEnd,
      relevanceStatus: relevance.status,
      matchedKeyPageRole: relevance.matchedRole,
      scores: { demand, reachability, businessRelevance, confidence, effort, priority },
      rationaleCodes,
    });
  }

  return candidates;
}
```

- [ ] **Step 4: Run detector tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/detectors/gscStrikingDistanceDetector.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing recommendation-builder tests**

```ts
// src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.test.ts
import { describe, expect, it } from "vitest";
import { buildDeterministicRecommendation } from "./TrendbriefRecommendationBuilder";
import type { StrikingDistanceCandidate } from "../detectors/gscStrikingDistanceDetector";

const candidate: StrikingDistanceCandidate = {
  subjectUrl: "/tree-removal-cheltenham",
  subjectQuery: "tree removal cheltenham",
  evidenceIds: ["evidence_1"],
  metrics: { clicks: 20, impressions: 400, ctr: 0.05, position: 8 },
  observationStart: "2026-08-01",
  observationEnd: "2026-08-28",
  relevanceStatus: "confirmed",
  matchedKeyPageRole: "money",
  scores: { demand: 0.6, reachability: 0.7, businessRelevance: 1, confidence: 0.8, effort: 0.2, priority: 67 },
  rationaleCodes: ["striking_distance", "meaningful_impressions", "healthy_ctr", "commercial_relevance_confirmed_money"],
};

describe("buildDeterministicRecommendation", () => {
  it("proposes improving the existing page, carries the candidate's rationale codes verbatim, and does not invent content changes", () => {
    const recommendation = buildDeterministicRecommendation(candidate);
    expect(recommendation.proposedAction.page).toBe("/tree-removal-cheltenham");
    expect(recommendation.proposedAction.reasonCodes).toEqual(candidate.rationaleCodes);
    expect(recommendation.proposedAction.suggestedNextAnalysis).toEqual([
      "inspect_ranking_serp",
      "inspect_page_content",
      "inspect_technical_audit",
    ]);
  });

  it("grounds the summary in the measured metrics, not an invented claim", () => {
    const recommendation = buildDeterministicRecommendation(candidate);
    expect(recommendation.groundedSummary).toContain("/tree-removal-cheltenham");
    expect(recommendation.groundedSummary).toContain("tree removal cheltenham");
    expect(recommendation.groundedSummary).toContain("400");
    expect(recommendation.groundedSummary).toContain("8");
  });
});
```

- [ ] **Step 6: Run recommendation-builder tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefRecommendationBuilder'"

- [ ] **Step 7: Implement the recommendation builder**

```ts
// src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.ts
import type { StrikingDistanceCandidate } from "../detectors/gscStrikingDistanceDetector";

export type DeterministicRecommendation = {
  proposedAction: {
    page: string;
    reasonCodes: string[];
    suggestedNextAnalysis: string[];
  };
  groundedSummary: string;
};

// Templated entirely from measured fields on the candidate — no free text,
// no invented content changes. This is the "grounded factual summary" the
// brief requires; an AI-authored explanation can be layered on top later
// without changing this deterministic baseline (see specs/0012).
export function buildDeterministicRecommendation(
  candidate: StrikingDistanceCandidate,
): DeterministicRecommendation {
  const ctrPct = (candidate.metrics.ctr * 100).toFixed(1);
  const groundedSummary =
    `"${candidate.subjectUrl}" ranks at position ${candidate.metrics.position} ` +
    `for the query "${candidate.subjectQuery}", with ${candidate.metrics.impressions} impressions ` +
    `and a ${ctrPct}% CTR over ${candidate.observationStart} to ${candidate.observationEnd}.`;

  return {
    proposedAction: {
      page: candidate.subjectUrl,
      reasonCodes: candidate.rationaleCodes,
      suggestedNextAnalysis: [
        "inspect_ranking_serp",
        "inspect_page_content",
        "inspect_technical_audit",
      ],
    },
    groundedSummary,
  };
}
```

- [ ] **Step 8: Run recommendation-builder tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/server/features/trendbrief/detectors src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.ts src/server/features/trendbrief/services/TrendbriefRecommendationBuilder.test.ts
git commit -m "feat(trendbrief): add GSC striking-distance detector and deterministic recommendation builder"
```

---

### Task 9: Opportunity, opportunity-evidence, and recommendation repositories

**Files:**
- Create: `src/server/features/trendbrief/repositories/TrendbriefOpportunityRepository.ts`
- Test: `src/server/features/trendbrief/repositories/TrendbriefOpportunityRepository.test.ts`
- Create: `src/server/features/trendbrief/repositories/TrendbriefOpportunityEvidenceRepository.ts`
- Create: `src/server/features/trendbrief/repositories/TrendbriefRecommendationRepository.ts`
- Test: `src/server/features/trendbrief/repositories/TrendbriefRecommendationRepository.test.ts`

**Interfaces:**
- Consumes: `trendbriefOpportunities`, `trendbriefOpportunityEvidence`, `trendbriefRecommendations` from `@/db/schema` (Task 1); `TrendbriefOpportunityStatus`, `TrendbriefRelevanceStatus` from `../domain/types` (Task 2).
- Produces: `TrendbriefOpportunity` type, `TrendbriefOpportunityRepository.{upsertFromDetection, getForProject, listForProject, updateStatus}`; `TrendbriefOpportunityEvidenceRepository.{linkEvidence, listEvidenceForOpportunity}`; `TrendbriefRecommendation` type, `TrendbriefRecommendationRepository.{upsertForOpportunity, getByOpportunityId}` — all consumed by Task 10 (analysis orchestration), Task 11 (lifecycle), and Task 13 (MCP tools).

**Tenant safety:** every read/update after creation takes an explicit `projectId` and filters by it (`getForProject`, `listForProject`, `updateStatus`) — a guessed/foreign `opportunityId` with the wrong `projectId` returns nothing, matching the `ProjectRepository.getProjectForOrganization` pattern (`src/server/features/projects/repositories/ProjectRepository.ts:29-44`) that already gates every project-scoped server function.

**Idempotency:** `upsertFromDetection` looks up by `dedupeKey` first. If no row exists, it inserts with `status: "detected"`. If a row exists, it **updates scores and `lastDetectedAt` but only carries `status` forward unchanged** — a human decision (`accepted`/`rejected`/etc.) is never silently reverted by a re-detection run. The database's unique index on `dedupeKey` (Task 1) is the hard backstop against a duplicate row if two detection runs somehow race; this select-then-branch is not wrapped in a transaction (see specs/0012 "Deviations" for why that's an acceptable simplification for TB-001's single-operator execution model).

- [ ] **Step 1: Write the failing opportunity-repository tests**

```ts
// src/server/features/trendbrief/repositories/TrendbriefOpportunityRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOpportunityRepository } from "./TrendbriefOpportunityRepository";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update } }));

function selectReturning(rows: unknown[]) {
  const builder = { from: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue(rows), orderBy: vi.fn().mockResolvedValue(rows) };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  return builder;
}

describe("TrendbriefOpportunityRepository.upsertFromDetection", () => {
  const detectionInput = {
    organizationId: "org_1",
    projectId: "project_1",
    detectorId: "gsc-striking-distance",
    detectorVersion: "v1",
    type: "improve_existing_page" as const,
    subjectUrl: "/page",
    subjectQuery: "query",
    impactScore: 0.6,
    effortScore: 0.2,
    confidenceScore: 0.8,
    priorityScore: 67,
    rationaleCodes: ["striking_distance"],
    relevanceStatus: "confirmed" as const,
    expiresAt: "2026-10-01T00:00:00.000Z",
    dedupeKey: "dedupe_1",
  };

  beforeEach(() => {
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
  });

  it("inserts a new row with status 'detected' when no existing opportunity matches the dedupeKey", async () => {
    mocks.select.mockReturnValue(selectReturning([]));
    const insertBuilder = {
      values: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: "opp_1", status: "detected" }]),
    };
    insertBuilder.values.mockReturnValue(insertBuilder);
    mocks.insert.mockReturnValue(insertBuilder);

    const { opportunity, wasNew } = await TrendbriefOpportunityRepository.upsertFromDetection(detectionInput);

    expect(wasNew).toBe(true);
    expect(opportunity.id).toBe("opp_1");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates scores/lastDetectedAt but preserves a non-'detected' status on re-detection", async () => {
    mocks.select.mockReturnValue(selectReturning([{ id: "opp_1", status: "accepted", dedupeKey: "dedupe_1" }]));
    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: "opp_1", status: "accepted" }]),
    };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    mocks.update.mockReturnValue(updateBuilder);

    const { opportunity, wasNew } = await TrendbriefOpportunityRepository.upsertFromDetection(detectionInput);

    expect(wasNew).toBe(false);
    expect(opportunity.status).toBe("accepted");
    const setArgs = updateBuilder.set.mock.calls[0][0];
    expect(setArgs.status).toBe("accepted");
    expect(setArgs.priorityScore).toBe(67);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("TrendbriefOpportunityRepository.getForProject", () => {
  it("filters by both opportunityId and projectId so a foreign project's id returns null", async () => {
    mocks.select.mockReturnValue(selectReturning([]));
    const result = await TrendbriefOpportunityRepository.getForProject("project_1", "opp_from_other_org");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/repositories/TrendbriefOpportunityRepository.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefOpportunityRepository'"

- [ ] **Step 3: Implement the opportunity repository**

```ts
// src/server/features/trendbrief/repositories/TrendbriefOpportunityRepository.ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefOpportunities } from "@/db/schema";
import type { TrendbriefOpportunityStatus, TrendbriefRelevanceStatus } from "../domain/types";

export type TrendbriefOpportunity = typeof trendbriefOpportunities.$inferSelect;

export type DetectionUpsertInput = {
  organizationId: string;
  projectId: string;
  detectorId: string;
  detectorVersion: string;
  type: "improve_existing_page";
  subjectUrl: string;
  subjectQuery: string;
  impactScore: number;
  effortScore: number;
  confidenceScore: number;
  priorityScore: number;
  rationaleCodes: string[];
  relevanceStatus: TrendbriefRelevanceStatus;
  expiresAt: string;
  dedupeKey: string;
};

async function getByDedupeKey(dedupeKey: string): Promise<TrendbriefOpportunity | null> {
  const rows = await db
    .select()
    .from(trendbriefOpportunities)
    .where(eq(trendbriefOpportunities.dedupeKey, dedupeKey))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertFromDetection(
  input: DetectionUpsertInput,
): Promise<{ opportunity: TrendbriefOpportunity; wasNew: boolean }> {
  const existing = await getByDedupeKey(input.dedupeKey);
  const nowIso = new Date().toISOString();

  if (!existing) {
    const [row] = await db
      .insert(trendbriefOpportunities)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        detectorId: input.detectorId,
        detectorVersion: input.detectorVersion,
        type: input.type,
        subjectUrl: input.subjectUrl,
        subjectQuery: input.subjectQuery,
        status: "detected",
        impactScore: input.impactScore,
        effortScore: input.effortScore,
        confidenceScore: input.confidenceScore,
        priorityScore: input.priorityScore,
        rationaleCodes: JSON.stringify(input.rationaleCodes),
        relevanceStatus: input.relevanceStatus,
        firstDetectedAt: nowIso,
        lastDetectedAt: nowIso,
        expiresAt: input.expiresAt,
        dedupeKey: input.dedupeKey,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();
    if (!row) throw new Error("Failed to insert trendbrief_opportunity");
    return { opportunity: row, wasNew: true };
  }

  const [row] = await db
    .update(trendbriefOpportunities)
    .set({
      impactScore: input.impactScore,
      effortScore: input.effortScore,
      confidenceScore: input.confidenceScore,
      priorityScore: input.priorityScore,
      rationaleCodes: JSON.stringify(input.rationaleCodes),
      relevanceStatus: input.relevanceStatus,
      lastDetectedAt: nowIso,
      expiresAt: input.expiresAt,
      status: existing.status,
      updatedAt: nowIso,
    })
    .where(eq(trendbriefOpportunities.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update trendbrief_opportunity");
  return { opportunity: row, wasNew: false };
}

async function getForProject(
  projectId: string,
  opportunityId: string,
): Promise<TrendbriefOpportunity | null> {
  const rows = await db
    .select()
    .from(trendbriefOpportunities)
    .where(
      and(
        eq(trendbriefOpportunities.id, opportunityId),
        eq(trendbriefOpportunities.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listForProject(projectId: string): Promise<TrendbriefOpportunity[]> {
  return db
    .select()
    .from(trendbriefOpportunities)
    .where(eq(trendbriefOpportunities.projectId, projectId))
    .orderBy(desc(trendbriefOpportunities.priorityScore));
}

async function updateStatus(
  opportunityId: string,
  projectId: string,
  status: TrendbriefOpportunityStatus,
): Promise<TrendbriefOpportunity | null> {
  const [row] = await db
    .update(trendbriefOpportunities)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(trendbriefOpportunities.id, opportunityId),
        eq(trendbriefOpportunities.projectId, projectId),
      ),
    )
    .returning();
  return row ?? null;
}

export const TrendbriefOpportunityRepository = {
  upsertFromDetection,
  getForProject,
  listForProject,
  updateStatus,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/repositories/TrendbriefOpportunityRepository.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement the opportunity-evidence join repository (no dedicated test — thin pass-through covered end-to-end by Task 10's analysis-service test)**

```ts
// src/server/features/trendbrief/repositories/TrendbriefOpportunityEvidenceRepository.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefEvidence, trendbriefOpportunityEvidence } from "@/db/schema";
import type { TrendbriefEvidence } from "./TrendbriefEvidenceRepository";

async function linkEvidence(opportunityId: string, evidenceIds: string[]): Promise<void> {
  for (const evidenceId of evidenceIds) {
    await db
      .insert(trendbriefOpportunityEvidence)
      .values({ opportunityId, evidenceId, createdAt: new Date().toISOString() })
      .onConflictDoNothing({
        target: [trendbriefOpportunityEvidence.opportunityId, trendbriefOpportunityEvidence.evidenceId],
      });
  }
}

async function listEvidenceForOpportunity(opportunityId: string): Promise<TrendbriefEvidence[]> {
  const rows = await db
    .select({ evidence: trendbriefEvidence })
    .from(trendbriefOpportunityEvidence)
    .innerJoin(
      trendbriefEvidence,
      eq(trendbriefOpportunityEvidence.evidenceId, trendbriefEvidence.id),
    )
    .where(eq(trendbriefOpportunityEvidence.opportunityId, opportunityId));
  return rows.map((row) => row.evidence);
}

export const TrendbriefOpportunityEvidenceRepository = { linkEvidence, listEvidenceForOpportunity };
```

- [ ] **Step 6: Write the failing recommendation-repository tests**

```ts
// src/server/features/trendbrief/repositories/TrendbriefRecommendationRepository.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefRecommendationRepository } from "./TrendbriefRecommendationRepository";

const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update } }));

function selectReturning(rows: unknown[]) {
  const builder = { from: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue(rows) };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  return builder;
}

const upsertInput = {
  opportunityId: "opp_1",
  organizationId: "org_1",
  projectId: "project_1",
  recommendationType: "improve_existing_page" as const,
  proposedAction: { page: "/page", reasonCodes: ["striking_distance"], suggestedNextAnalysis: ["inspect_ranking_serp"] },
  groundedSummary: "summary text",
};

describe("TrendbriefRecommendationRepository.upsertForOpportunity", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
  });

  it("inserts version 1 with generationMethod 'deterministic' when none exists", async () => {
    mocks.select.mockReturnValue(selectReturning([]));
    const insertBuilder = { values: vi.fn(), returning: vi.fn().mockResolvedValue([{ id: "rec_1", version: 1 }]) };
    insertBuilder.values.mockReturnValue(insertBuilder);
    mocks.insert.mockReturnValue(insertBuilder);

    await TrendbriefRecommendationRepository.upsertForOpportunity(upsertInput);

    const insertedValues = insertBuilder.values.mock.calls[0][0];
    expect(insertedValues.version).toBe(1);
    expect(insertedValues.generationMethod).toBe("deterministic");
    expect(JSON.parse(insertedValues.proposedAction)).toEqual(upsertInput.proposedAction);
  });

  it("bumps the version on regeneration for an existing opportunity", async () => {
    mocks.select.mockReturnValue(selectReturning([{ id: "rec_1", version: 1 }]));
    const updateBuilder = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([{ id: "rec_1", version: 2 }]) };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    mocks.update.mockReturnValue(updateBuilder);

    const result = await TrendbriefRecommendationRepository.upsertForOpportunity(upsertInput);

    expect(result.version).toBe(2);
    expect(updateBuilder.set.mock.calls[0][0].version).toBe(2);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/repositories/TrendbriefRecommendationRepository.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefRecommendationRepository'"

- [ ] **Step 8: Implement the recommendation repository**

```ts
// src/server/features/trendbrief/repositories/TrendbriefRecommendationRepository.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefRecommendations } from "@/db/schema";

export type TrendbriefRecommendation = typeof trendbriefRecommendations.$inferSelect;

export type ProposedAction = {
  page: string;
  reasonCodes: string[];
  suggestedNextAnalysis: string[];
};

async function getByOpportunityId(opportunityId: string): Promise<TrendbriefRecommendation | null> {
  const rows = await db
    .select()
    .from(trendbriefRecommendations)
    .where(eq(trendbriefRecommendations.opportunityId, opportunityId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertForOpportunity(input: {
  opportunityId: string;
  organizationId: string;
  projectId: string;
  recommendationType: "improve_existing_page";
  proposedAction: ProposedAction;
  groundedSummary: string;
}): Promise<TrendbriefRecommendation> {
  const existing = await getByOpportunityId(input.opportunityId);
  const nowIso = new Date().toISOString();

  if (!existing) {
    const [row] = await db
      .insert(trendbriefRecommendations)
      .values({
        id: crypto.randomUUID(),
        opportunityId: input.opportunityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        version: 1,
        recommendationType: input.recommendationType,
        generationMethod: "deterministic",
        proposedAction: JSON.stringify(input.proposedAction),
        groundedSummary: input.groundedSummary,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();
    if (!row) throw new Error("Failed to insert trendbrief_recommendation");
    return row;
  }

  const [row] = await db
    .update(trendbriefRecommendations)
    .set({
      version: existing.version + 1,
      proposedAction: JSON.stringify(input.proposedAction),
      groundedSummary: input.groundedSummary,
      updatedAt: nowIso,
    })
    .where(eq(trendbriefRecommendations.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update trendbrief_recommendation");
  return row;
}

export const TrendbriefRecommendationRepository = { upsertForOpportunity, getByOpportunityId };
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/repositories/TrendbriefRecommendationRepository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 10: Type-check the whole trendbrief feature so far**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/server/features/trendbrief/repositories
git commit -m "feat(trendbrief): add opportunity, opportunity-evidence, and recommendation repositories"
```

---

### Task 10: Analysis orchestration service ("analyse project")

**Files:**
- Create: `src/server/features/trendbrief/services/TrendbriefAnalysisService.ts`
- Test: `src/server/features/trendbrief/services/TrendbriefAnalysisService.test.ts`

**Interfaces:**
- Consumes: `TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence` (Task 7); `detectGscStrikingDistanceCandidates` (Task 8); `buildDeterministicRecommendation` (Task 8); `ProjectContextRepository.listKeyPages` from `@/server/features/project-context/repositories/ProjectContextRepository` (existing, `src/server/features/project-context/repositories/ProjectContextRepository.ts:151`); `TrendbriefOpportunityRepository.upsertFromDetection` (Task 9); `TrendbriefOpportunityEvidenceRepository.linkEvidence` (Task 9); `TrendbriefRecommendationRepository.upsertForOpportunity` (Task 9); `computeOpportunityDedupeKey`, `GSC_STRIKING_DISTANCE_DETECTOR_KEY`, `GSC_STRIKING_DISTANCE_DETECTOR_ID`, `GSC_STRIKING_DISTANCE_DETECTOR_VERSION` (Task 2); `OPPORTUNITY_STALE_AFTER_DAYS` (Task 3).
- Produces: `TrendbriefAnalysisService.analyzeProject(input)` returning `{evidenceIngested, opportunitiesDetected, opportunitiesCreated, opportunitiesUpdated}` — consumed by Task 13's `analyze_trendbrief_opportunities` MCP tool. This is the "operator runs 'analyse project'" execution route the brief requires; `opportunitiesUpdated` is how the brief's "existing opportunities updated; duplicates skipped" requirement is represented (a re-detected candidate updates its existing row in place rather than being skipped silently or duplicated).

This is where the brief's required idempotency property is proven end to end: running `analyzeProject` twice with unchanged evidence must not grow the opportunity count.

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/features/trendbrief/services/TrendbriefAnalysisService.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefAnalysisService } from "./TrendbriefAnalysisService";

const mocks = vi.hoisted(() => ({
  collectGscStrikingDistanceEvidence: vi.fn(),
  listKeyPages: vi.fn(),
  upsertFromDetection: vi.fn(),
  linkEvidence: vi.fn(),
  upsertForOpportunity: vi.fn(),
}));

vi.mock("./TrendbriefEvidenceCollector", () => ({
  TrendbriefEvidenceCollector: { collectGscStrikingDistanceEvidence: mocks.collectGscStrikingDistanceEvidence },
}));
vi.mock("@/server/features/project-context/repositories/ProjectContextRepository", () => ({
  ProjectContextRepository: { listKeyPages: mocks.listKeyPages },
}));
vi.mock("../repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { upsertFromDetection: mocks.upsertFromDetection },
}));
vi.mock("../repositories/TrendbriefOpportunityEvidenceRepository", () => ({
  TrendbriefOpportunityEvidenceRepository: { linkEvidence: mocks.linkEvidence },
}));
vi.mock("../repositories/TrendbriefRecommendationRepository", () => ({
  TrendbriefRecommendationRepository: { upsertForOpportunity: mocks.upsertForOpportunity },
}));

const qualifyingEvidenceRow = {
  id: "evidence_1",
  organizationId: "org_1",
  projectId: "project_1",
  source: "gsc",
  evidenceType: "gsc_page_query_performance",
  subjectUrl: "/tree-removal-cheltenham",
  subjectQuery: "tree removal cheltenham",
  observationStart: "2026-08-01",
  observationEnd: "2026-08-28",
  dataState: "final",
  metrics: JSON.stringify({ clicks: 20, impressions: 400, ctr: 0.05, position: 8 }),
  dedupeKey: "evidence_dedupe_1",
  capturedAt: "2026-08-28T00:00:00.000Z",
  createdAt: "2026-08-28T00:00:00.000Z",
};

describe("TrendbriefAnalysisService.analyzeProject", () => {
  beforeEach(() => {
    mocks.collectGscStrikingDistanceEvidence.mockReset();
    mocks.listKeyPages.mockReset();
    mocks.upsertFromDetection.mockReset();
    mocks.linkEvidence.mockReset();
    mocks.upsertForOpportunity.mockReset();

    mocks.collectGscStrikingDistanceEvidence.mockResolvedValue({
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
      rowsConsidered: 1,
      rowsInStrikingDistance: 1,
      evidence: [qualifyingEvidenceRow],
    });
    mocks.listKeyPages.mockResolvedValue([]);
    mocks.linkEvidence.mockResolvedValue(undefined);
    mocks.upsertForOpportunity.mockResolvedValue({ id: "rec_1", version: 1 });
  });

  it("creates a new opportunity, links evidence, and writes a deterministic recommendation on first analysis", async () => {
    mocks.upsertFromDetection.mockResolvedValue({
      opportunity: { id: "opp_1", status: "detected" },
      wasNew: true,
    });

    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.evidenceIngested).toBe(1);
    expect(result.opportunitiesDetected).toBe(1);
    expect(result.opportunitiesCreated).toBe(1);
    expect(result.opportunitiesUpdated).toBe(0);
    expect(mocks.upsertFromDetection).toHaveBeenCalledTimes(1);
    expect(mocks.linkEvidence).toHaveBeenCalledWith("opp_1", ["evidence_1"]);
    expect(mocks.upsertForOpportunity).toHaveBeenCalledTimes(1);
    const detectionArgs = mocks.upsertFromDetection.mock.calls[0][0];
    expect(detectionArgs.detectorId).toBe("gsc-striking-distance");
    expect(detectionArgs.detectorVersion).toBe("v1");
  });

  it("re-running analysis with identical evidence updates the existing opportunity instead of creating a second one", async () => {
    mocks.upsertFromDetection.mockResolvedValue({
      opportunity: { id: "opp_1", status: "detected" },
      wasNew: false,
    });

    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.opportunitiesCreated).toBe(0);
    expect(result.opportunitiesUpdated).toBe(1);
    expect(mocks.upsertFromDetection).toHaveBeenCalledTimes(1);
  });

  it("does not detect or persist anything when no evidence qualifies", async () => {
    mocks.collectGscStrikingDistanceEvidence.mockResolvedValue({
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
      rowsConsidered: 0,
      rowsInStrikingDistance: 0,
      evidence: [],
    });

    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.opportunitiesDetected).toBe(0);
    expect(mocks.upsertFromDetection).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefAnalysisService.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefAnalysisService'"

- [ ] **Step 3: Implement the analysis service**

```ts
// src/server/features/trendbrief/services/TrendbriefAnalysisService.ts
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { computeOpportunityDedupeKey } from "../domain/dedupeKeys";
import {
  GSC_STRIKING_DISTANCE_DETECTOR_ID,
  GSC_STRIKING_DISTANCE_DETECTOR_KEY,
  GSC_STRIKING_DISTANCE_DETECTOR_VERSION,
} from "../domain/types";
import { detectGscStrikingDistanceCandidates } from "../detectors/gscStrikingDistanceDetector";
import { TrendbriefOpportunityEvidenceRepository } from "../repositories/TrendbriefOpportunityEvidenceRepository";
import { TrendbriefOpportunityRepository } from "../repositories/TrendbriefOpportunityRepository";
import { TrendbriefRecommendationRepository } from "../repositories/TrendbriefRecommendationRepository";
import { OPPORTUNITY_STALE_AFTER_DAYS } from "../scoring/constants";
import { buildDeterministicRecommendation } from "./TrendbriefRecommendationBuilder";
import { TrendbriefEvidenceCollector } from "./TrendbriefEvidenceCollector";

export type AnalyzeProjectInput = {
  organizationId: string;
  projectId: string;
  startDate?: string;
  endDate?: string;
};

export type AnalyzeProjectResult = {
  evidenceIngested: number;
  opportunitiesDetected: number;
  opportunitiesCreated: number;
  // A re-detected candidate that already had a persisted opportunity: the
  // brief's "existing opportunities updated / duplicates skipped" outcome —
  // the row is refreshed in place, never duplicated.
  opportunitiesUpdated: number;
};

async function analyzeProject(input: AnalyzeProjectInput): Promise<AnalyzeProjectResult> {
  const [collected, keyPages] = await Promise.all([
    TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence(input),
    ProjectContextRepository.listKeyPages(input.projectId),
  ]);

  const candidates = detectGscStrikingDistanceCandidates({
    evidence: collected.evidence,
    keyPages,
  });

  let created = 0;
  let updated = 0;
  const expiresAt = new Date(
    Date.now() + OPPORTUNITY_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (const candidate of candidates) {
    const dedupeKey = computeOpportunityDedupeKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      detectorKey: GSC_STRIKING_DISTANCE_DETECTOR_KEY,
      subjectUrl: candidate.subjectUrl,
      subjectQuery: candidate.subjectQuery,
    });

    const { opportunity, wasNew } = await TrendbriefOpportunityRepository.upsertFromDetection({
      organizationId: input.organizationId,
      projectId: input.projectId,
      detectorId: GSC_STRIKING_DISTANCE_DETECTOR_ID,
      detectorVersion: GSC_STRIKING_DISTANCE_DETECTOR_VERSION,
      type: "improve_existing_page",
      subjectUrl: candidate.subjectUrl,
      subjectQuery: candidate.subjectQuery,
      impactScore: candidate.scores.demand,
      effortScore: candidate.scores.effort,
      confidenceScore: candidate.scores.confidence,
      priorityScore: candidate.scores.priority,
      rationaleCodes: candidate.rationaleCodes,
      relevanceStatus: candidate.relevanceStatus,
      expiresAt,
      dedupeKey,
    });

    await TrendbriefOpportunityEvidenceRepository.linkEvidence(
      opportunity.id,
      candidate.evidenceIds,
    );

    const recommendation = buildDeterministicRecommendation(candidate);
    await TrendbriefRecommendationRepository.upsertForOpportunity({
      opportunityId: opportunity.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      recommendationType: "improve_existing_page",
      proposedAction: recommendation.proposedAction,
      groundedSummary: recommendation.groundedSummary,
    });

    if (wasNew) created += 1;
    else updated += 1;
  }

  return {
    evidenceIngested: collected.evidence.length,
    opportunitiesDetected: candidates.length,
    opportunitiesCreated: created,
    opportunitiesUpdated: updated,
  };
}

export const TrendbriefAnalysisService = { analyzeProject };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefAnalysisService.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/features/trendbrief/services/TrendbriefAnalysisService.ts src/server/features/trendbrief/services/TrendbriefAnalysisService.test.ts
git commit -m "feat(trendbrief): add analysis orchestration service"
```

---

### Task 11: Action repository and opportunity lifecycle service

**Files:**
- Create: `src/server/features/trendbrief/repositories/TrendbriefActionRepository.ts`
- Create: `src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.ts`
- Test: `src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.test.ts`

**Interfaces:**
- Consumes: `trendbriefActions` from `@/db/schema` (Task 1); `TrendbriefActionType` from `../domain/types` (Task 2); `TrendbriefOpportunityRepository.{getForProject, updateStatus}` from `../repositories/TrendbriefOpportunityRepository` (Task 9); `AppError` from `@/server/lib/errors` (existing).
- Produces: `TrendbriefAction` type, `TrendbriefActionRepository.{recordAction, getByOpportunityId}`; `TrendbriefOpportunityLifecycleService.{acceptOpportunity, rejectOpportunity, completeOpportunity}` — consumed by Task 13's `set_trendbrief_opportunity_status` MCP tool.

**Valid transitions implemented in TB-001** (per the brief's explicit minimum): `detected -> accepted | rejected`, `accepted -> completed`. `completed -> measuring` and `measuring -> successful | inconclusive | unsuccessful` are recognized status values (Task 1's enum) but **not yet driven by an automatic transition** in this slice — Task 12's outcome recording writes an outcome record without forcing the opportunity through those two statuses, which is called out as a deviation in specs/0012. `rejected`, `successful`, `inconclusive`, `unsuccessful`, `expired`, `superseded` are terminal (no further transitions in TB-001).

**Known limitation** (documented in specs/0012, not fixed in TB-001): `updateStatus` and `recordAction` are two sequential, non-atomic writes — acceptable for a single-operator-triggered vertical slice with no concurrent-writer risk; production hardening would wrap both via `runBatch` (`src/db/runBatch.ts`).

- [ ] **Step 1: Implement the action repository (thin, covered by the lifecycle-service tests below)**

```ts
// src/server/features/trendbrief/repositories/TrendbriefActionRepository.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefActions } from "@/db/schema";
import type { TrendbriefActionType } from "../domain/types";

export type TrendbriefAction = typeof trendbriefActions.$inferSelect;

function statusForActionType(actionType: TrendbriefActionType): "accepted" | "rejected" | "completed" {
  if (actionType === "reject") return "rejected";
  if (actionType === "complete") return "completed";
  return "accepted";
}

async function getByOpportunityId(opportunityId: string): Promise<TrendbriefAction | null> {
  const rows = await db
    .select()
    .from(trendbriefActions)
    .where(eq(trendbriefActions.opportunityId, opportunityId))
    .limit(1);
  return rows[0] ?? null;
}

async function recordAction(input: {
  organizationId: string;
  projectId: string;
  opportunityId: string;
  actionType: TrendbriefActionType;
  actor: string;
  notes: string | null;
}): Promise<TrendbriefAction> {
  const existing = await getByOpportunityId(input.opportunityId);
  const nowIso = new Date().toISOString();
  const status = statusForActionType(input.actionType);
  const timestampFields =
    input.actionType === "accept"
      ? { acceptedAt: nowIso }
      : input.actionType === "complete"
        ? { completedAt: nowIso }
        : {};

  if (!existing) {
    const [row] = await db
      .insert(trendbriefActions)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        opportunityId: input.opportunityId,
        actionType: input.actionType,
        status,
        actor: input.actor,
        notes: input.notes,
        acceptedAt: null,
        completedAt: null,
        ...timestampFields,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();
    if (!row) throw new Error("Failed to insert trendbrief_action");
    return row;
  }

  const [row] = await db
    .update(trendbriefActions)
    .set({
      actionType: input.actionType,
      status,
      notes: input.notes ?? existing.notes,
      ...timestampFields,
      updatedAt: nowIso,
    })
    .where(eq(trendbriefActions.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update trendbrief_action");
  return row;
}

export const TrendbriefActionRepository = { recordAction, getByOpportunityId };
```

- [ ] **Step 2: Write the failing lifecycle-service tests**

```ts
// src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOpportunityLifecycleService } from "./TrendbriefOpportunityLifecycleService";

const mocks = vi.hoisted(() => ({
  getForProject: vi.fn(),
  updateStatus: vi.fn(),
  recordAction: vi.fn(),
}));

vi.mock("../repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { getForProject: mocks.getForProject, updateStatus: mocks.updateStatus },
}));
vi.mock("../repositories/TrendbriefActionRepository", () => ({
  TrendbriefActionRepository: { recordAction: mocks.recordAction },
}));

describe("TrendbriefOpportunityLifecycleService", () => {
  beforeEach(() => {
    mocks.getForProject.mockReset();
    mocks.updateStatus.mockReset();
    mocks.recordAction.mockReset();
    mocks.recordAction.mockResolvedValue({ id: "action_1" });
  });

  it("accepts a 'detected' opportunity and records an accept action", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "detected" });
    mocks.updateStatus.mockResolvedValue({ id: "opp_1", status: "accepted" });

    const result = await TrendbriefOpportunityLifecycleService.acceptOpportunity({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actor: "user_1",
    });

    expect(result.status).toBe("accepted");
    expect(mocks.updateStatus).toHaveBeenCalledWith("opp_1", "project_1", "accepted");
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "accept", actor: "user_1", opportunityId: "opp_1" }),
    );
  });

  it("rejects a 'detected' opportunity", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "detected" });
    mocks.updateStatus.mockResolvedValue({ id: "opp_1", status: "rejected" });

    const result = await TrendbriefOpportunityLifecycleService.rejectOpportunity({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actor: "user_1",
    });

    expect(result.status).toBe("rejected");
  });

  it("completes an 'accepted' opportunity", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "accepted" });
    mocks.updateStatus.mockResolvedValue({ id: "opp_1", status: "completed" });

    const result = await TrendbriefOpportunityLifecycleService.completeOpportunity({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actor: "user_1",
    });

    expect(result.status).toBe("completed");
  });

  it("rejects completing a 'detected' opportunity (invalid transition — must be accepted first)", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "detected" });

    await expect(
      TrendbriefOpportunityLifecycleService.completeOpportunity({
        organizationId: "org_1",
        projectId: "project_1",
        opportunityId: "opp_1",
        actor: "user_1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects accepting an already-rejected opportunity (terminal state)", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "rejected" });

    await expect(
      TrendbriefOpportunityLifecycleService.acceptOpportunity({
        organizationId: "org_1",
        projectId: "project_1",
        opportunityId: "opp_1",
        actor: "user_1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws NOT_FOUND for an opportunity that doesn't belong to the given project", async () => {
    mocks.getForProject.mockResolvedValue(null);

    await expect(
      TrendbriefOpportunityLifecycleService.acceptOpportunity({
        organizationId: "org_1",
        projectId: "project_1",
        opportunityId: "opp_from_other_org",
        actor: "user_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefOpportunityLifecycleService'"

- [ ] **Step 4: Implement the lifecycle service**

```ts
// src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.ts
import { AppError } from "@/server/lib/errors";
import type { TrendbriefActionType, TrendbriefOpportunityStatus } from "../domain/types";
import { TrendbriefActionRepository } from "../repositories/TrendbriefActionRepository";
import {
  TrendbriefOpportunityRepository,
  type TrendbriefOpportunity,
} from "../repositories/TrendbriefOpportunityRepository";

const VALID_TRANSITIONS: Record<TrendbriefOpportunityStatus, TrendbriefOpportunityStatus[]> = {
  detected: ["accepted", "rejected"],
  accepted: ["completed"],
  rejected: [],
  completed: ["measuring"],
  measuring: ["successful", "inconclusive", "unsuccessful"],
  successful: [],
  inconclusive: [],
  unsuccessful: [],
  expired: [],
  superseded: [],
};

function assertTransitionAllowed(
  from: TrendbriefOpportunityStatus,
  to: TrendbriefOpportunityStatus,
): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Cannot move a TrendBrief opportunity from "${from}" to "${to}".`,
    );
  }
}

export type TransitionInput = {
  organizationId: string;
  projectId: string;
  opportunityId: string;
  actor: string;
  notes?: string;
};

async function transitionOpportunity(
  input: TransitionInput & { actionType: TrendbriefActionType; nextStatus: TrendbriefOpportunityStatus },
): Promise<TrendbriefOpportunity> {
  const opportunity = await TrendbriefOpportunityRepository.getForProject(
    input.projectId,
    input.opportunityId,
  );
  if (!opportunity) throw new AppError("NOT_FOUND");

  assertTransitionAllowed(opportunity.status, input.nextStatus);

  const updated = await TrendbriefOpportunityRepository.updateStatus(
    input.opportunityId,
    input.projectId,
    input.nextStatus,
  );
  if (!updated) throw new AppError("NOT_FOUND");

  await TrendbriefActionRepository.recordAction({
    organizationId: input.organizationId,
    projectId: input.projectId,
    opportunityId: input.opportunityId,
    actionType: input.actionType,
    actor: input.actor,
    notes: input.notes ?? null,
  });

  return updated;
}

async function acceptOpportunity(input: TransitionInput): Promise<TrendbriefOpportunity> {
  return transitionOpportunity({ ...input, actionType: "accept", nextStatus: "accepted" });
}

async function rejectOpportunity(input: TransitionInput): Promise<TrendbriefOpportunity> {
  return transitionOpportunity({ ...input, actionType: "reject", nextStatus: "rejected" });
}

async function completeOpportunity(input: TransitionInput): Promise<TrendbriefOpportunity> {
  return transitionOpportunity({ ...input, actionType: "complete", nextStatus: "completed" });
}

export const TrendbriefOpportunityLifecycleService = {
  acceptOpportunity,
  rejectOpportunity,
  completeOpportunity,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/server/features/trendbrief/repositories/TrendbriefActionRepository.ts src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.ts src/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService.test.ts
git commit -m "feat(trendbrief): add action repository and opportunity lifecycle service"
```

---

### Task 12: Outcome repository and outcome measurement service

**Files:**
- Create: `src/server/features/trendbrief/repositories/TrendbriefOutcomeRepository.ts`
- Create: `src/server/features/trendbrief/services/TrendbriefOutcomeService.ts`
- Test: `src/server/features/trendbrief/services/TrendbriefOutcomeService.test.ts`

**Interfaces:**
- Consumes: `trendbriefOutcomes` from `@/db/schema` (Task 1); `GscService.getPerformance` from `@/server/features/gsc/services/GscService` (existing); `TrendbriefOpportunityRepository.getForProject` (Task 9); `OUTCOME_IMPROVEMENT_POSITION_THRESHOLD`, `SAMPLE_SIZE_CONFIDENCE_CEILING` from `../scoring/constants` (Task 3); `TrendbriefOutcomeClassification` from `../domain/types` (Task 2).
- Produces: `TrendbriefOutcome` type, `TrendbriefOutcomeRepository.record(input)`; `TrendbriefOutcomeService.recordOutcome(input)` — consumed by Task 13's `record_trendbrief_outcome` MCP tool.

This satisfies acceptance criterion 10 ("an outcome record can later compare baseline and comparison measurements") without a causal-analysis engine: it re-queries the SAME free GSC evidence source for two windows, filtered to the opportunity's exact page+query, and classifies the delta using correlational language only (`attributionNote`, never a causal claim).

- [ ] **Step 1: Implement the outcome repository (thin persistence, covered by the service test below)**

```ts
// src/server/features/trendbrief/repositories/TrendbriefOutcomeRepository.ts
import { db } from "@/db";
import { trendbriefOutcomes } from "@/db/schema";
import type { TrendbriefOutcomeClassification } from "../domain/types";

export type TrendbriefOutcome = typeof trendbriefOutcomes.$inferSelect;

export type OutcomeMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  hasData: boolean;
};

async function record(input: {
  opportunityId: string;
  organizationId: string;
  projectId: string;
  baselineWindowStart: string;
  baselineWindowEnd: string;
  comparisonWindowStart: string;
  comparisonWindowEnd: string;
  measuredMetrics: { baseline: OutcomeMetrics; comparison: OutcomeMetrics };
  classification: TrendbriefOutcomeClassification;
  confidenceScore: number;
}): Promise<TrendbriefOutcome> {
  const [row] = await db
    .insert(trendbriefOutcomes)
    .values({
      id: crypto.randomUUID(),
      opportunityId: input.opportunityId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      baselineWindowStart: input.baselineWindowStart,
      baselineWindowEnd: input.baselineWindowEnd,
      comparisonWindowStart: input.comparisonWindowStart,
      comparisonWindowEnd: input.comparisonWindowEnd,
      measuredMetrics: JSON.stringify(input.measuredMetrics),
      classification: input.classification,
      confidenceScore: input.confidenceScore,
      // Correlational language only — never a causal claim. See specs/0012
      // "Outcome" and the brief's explicit prohibition on causal attribution.
      attributionNote:
        "Performance changed after the recorded action; this reflects a correlation over time, not a proven causal effect.",
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [trendbriefOutcomes.opportunityId, trendbriefOutcomes.comparisonWindowEnd],
      set: {
        measuredMetrics: JSON.stringify(input.measuredMetrics),
        classification: input.classification,
        confidenceScore: input.confidenceScore,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to record trendbrief_outcome");
  return row;
}

export const TrendbriefOutcomeRepository = { record };
```

- [ ] **Step 2: Write the failing outcome-service tests**

```ts
// src/server/features/trendbrief/services/TrendbriefOutcomeService.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOutcomeService } from "./TrendbriefOutcomeService";

const mocks = vi.hoisted(() => ({
  getForProject: vi.fn(),
  getPerformance: vi.fn(),
  record: vi.fn(),
}));

vi.mock("../repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { getForProject: mocks.getForProject },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));
vi.mock("../repositories/TrendbriefOutcomeRepository", () => ({
  TrendbriefOutcomeRepository: { record: mocks.record },
}));

const baseInput = {
  organizationId: "org_1",
  projectId: "project_1",
  opportunityId: "opp_1",
  baselineWindow: { start: "2026-08-01", end: "2026-08-28" },
  comparisonWindow: { start: "2026-09-01", end: "2026-09-28" },
};

describe("TrendbriefOutcomeService.recordOutcome", () => {
  beforeEach(() => {
    mocks.getForProject.mockReset();
    mocks.getPerformance.mockReset();
    mocks.record.mockReset();
    mocks.getForProject.mockResolvedValue({
      id: "opp_1",
      projectId: "project_1",
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
    });
    mocks.record.mockImplementation(async (input) => ({ id: "outcome_1", ...input }));
  });

  it("classifies as improved when position gets closer to page 1", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({ rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 10 }] })
      .mockResolvedValueOnce({ rows: [{ clicks: 25, impressions: 320, ctr: 0.078, position: 6 }] });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("improved");
  });

  it("classifies as declined when position moves further from page 1", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({ rows: [{ clicks: 20, impressions: 300, ctr: 0.067, position: 6 }] })
      .mockResolvedValueOnce({ rows: [{ clicks: 8, impressions: 280, ctr: 0.029, position: 12 }] });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("declined");
  });

  it("classifies as inconclusive when either window has no data", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 8 }] });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("inconclusive");
  });

  it("never asserts a causal claim in the attribution note", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({ rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 10 }] })
      .mockResolvedValueOnce({ rows: [{ clicks: 25, impressions: 320, ctr: 0.078, position: 6 }] });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.attributionNote.toLowerCase()).not.toContain("caused");
    expect(outcome.attributionNote.toLowerCase()).toContain("correlation");
  });

  it("throws NOT_FOUND for an opportunity outside the given project", async () => {
    mocks.getForProject.mockResolvedValue(null);

    await expect(TrendbriefOutcomeService.recordOutcome(baseInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefOutcomeService.test.ts`
Expected: FAIL with "Cannot find module './TrendbriefOutcomeService'"

- [ ] **Step 4: Implement the outcome service**

```ts
// src/server/features/trendbrief/services/TrendbriefOutcomeService.ts
import { GscService } from "@/server/features/gsc/services/GscService";
import { AppError } from "@/server/lib/errors";
import type { GscSearchAnalyticsRow } from "@/server/lib/gscClient";
import type { TrendbriefOutcomeClassification } from "../domain/types";
import { TrendbriefOpportunityRepository } from "../repositories/TrendbriefOpportunityRepository";
import {
  TrendbriefOutcomeRepository,
  type OutcomeMetrics,
  type TrendbriefOutcome,
} from "../repositories/TrendbriefOutcomeRepository";
import { OUTCOME_IMPROVEMENT_POSITION_THRESHOLD, SAMPLE_SIZE_CONFIDENCE_CEILING } from "../scoring/constants";
import { roundComponent } from "../scoring/util";

export type RecordOutcomeInput = {
  organizationId: string;
  projectId: string;
  opportunityId: string;
  baselineWindow: { start: string; end: string };
  comparisonWindow: { start: string; end: string };
};

function summarizeRows(rows: GscSearchAnalyticsRow[]): OutcomeMetrics {
  const row = rows[0];
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: null, hasData: false };
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, hasData: true };
}

// Lower position number = closer to page 1 = better. positionDelta > 0 means
// the comparison window ranks BETTER than baseline.
function classifyOutcome(
  baseline: OutcomeMetrics,
  comparison: OutcomeMetrics,
): TrendbriefOutcomeClassification {
  if (!baseline.hasData || !comparison.hasData) return "inconclusive";
  if (baseline.position === null || comparison.position === null) return "inconclusive";
  const positionDelta = baseline.position - comparison.position;
  const clicksDelta = comparison.clicks - baseline.clicks;
  if (positionDelta >= OUTCOME_IMPROVEMENT_POSITION_THRESHOLD || clicksDelta > 0) return "improved";
  if (positionDelta <= -OUTCOME_IMPROVEMENT_POSITION_THRESHOLD || clicksDelta < 0) return "declined";
  return "unchanged";
}

function computeOutcomeConfidence(baseline: OutcomeMetrics, comparison: OutcomeMetrics): number {
  if (!baseline.hasData || !comparison.hasData) return 0;
  const sampleSize = Math.min(baseline.impressions, comparison.impressions);
  return roundComponent(Math.min(1, sampleSize / SAMPLE_SIZE_CONFIDENCE_CEILING));
}

async function recordOutcome(input: RecordOutcomeInput): Promise<TrendbriefOutcome> {
  const opportunity = await TrendbriefOpportunityRepository.getForProject(
    input.projectId,
    input.opportunityId,
  );
  if (!opportunity) throw new AppError("NOT_FOUND");

  const exactMatchFilters = [
    { dimension: "page" as const, operator: "equals" as const, expression: opportunity.subjectUrl },
    { dimension: "query" as const, operator: "equals" as const, expression: opportunity.subjectQuery },
  ];

  const [baselinePerformance, comparisonPerformance] = await Promise.all([
    GscService.getPerformance({
      projectId: input.projectId,
      dimensions: ["page", "query"],
      startDate: input.baselineWindow.start,
      endDate: input.baselineWindow.end,
      rowLimit: 10,
      startRow: 0,
      type: "web",
      dataState: "final",
      filters: exactMatchFilters,
    }),
    GscService.getPerformance({
      projectId: input.projectId,
      dimensions: ["page", "query"],
      startDate: input.comparisonWindow.start,
      endDate: input.comparisonWindow.end,
      rowLimit: 10,
      startRow: 0,
      type: "web",
      dataState: "final",
      filters: exactMatchFilters,
    }),
  ]);

  const baseline = summarizeRows(baselinePerformance.rows);
  const comparison = summarizeRows(comparisonPerformance.rows);
  const classification = classifyOutcome(baseline, comparison);
  const confidenceScore = computeOutcomeConfidence(baseline, comparison);

  return TrendbriefOutcomeRepository.record({
    opportunityId: input.opportunityId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    baselineWindowStart: input.baselineWindow.start,
    baselineWindowEnd: input.baselineWindow.end,
    comparisonWindowStart: input.comparisonWindow.start,
    comparisonWindowEnd: input.comparisonWindow.end,
    measuredMetrics: { baseline, comparison },
    classification,
    confidenceScore,
  });
}

export const TrendbriefOutcomeService = { recordOutcome };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/features/trendbrief/services/TrendbriefOutcomeService.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/features/trendbrief/repositories/TrendbriefOutcomeRepository.ts src/server/features/trendbrief/services/TrendbriefOutcomeService.ts src/server/features/trendbrief/services/TrendbriefOutcomeService.test.ts
git commit -m "feat(trendbrief): add outcome repository and outcome measurement service"
```

---

### Task 13: MCP tool surface (execution route + minimal operator UI) and tenant-authorization tests

**Files:**
- Create: `src/server/mcp/tools/trendbrief-tools.ts`
- Test: `src/server/mcp/tools/trendbrief-tools.test.ts`
- Modify: `src/server/mcp/server.ts`

**Interfaces:**
- Consumes: `withMcpProjectAuth` from `@/server/mcp/project-auth` (existing, already tenant-safe — `src/server/mcp/project-auth.ts:67-77`); `projectIdSchema` from `@/server/mcp/schemas`; `mcpResponse` from `@/server/mcp/formatters`; `looseObjectOutputSchema`, `objectSchema` from `@/server/mcp/output-schemas`; `buildProjectMeta` from `@/server/mcp/context`; `TrendbriefAnalysisService.analyzeProject` (Task 10); `TrendbriefOpportunityRepository.listForProject` (Task 9); `TrendbriefRecommendationRepository.getByOpportunityId` (Task 9); `TrendbriefOpportunityLifecycleService.{acceptOpportunity, rejectOpportunity, completeOpportunity}` (Task 11); `TrendbriefOutcomeService.recordOutcome` (Task 12).
- Produces: `analyzeTrendbriefOpportunitiesTool`, `listTrendbriefOpportunitiesTool`, `setTrendbriefOpportunityStatusTool`, `recordTrendbriefOutcomeTool` — registered in `src/server/mcp/server.ts`.

**Why MCP tools, not a new admin route:** this codebase's established pattern for an authenticated, project-scoped, manually-triggered action (the brief's "operator runs 'analyse project'" execution model) is exactly this — see `getSearchOpportunitiesTool` (`src/server/mcp/tools/google-analytics-tools.ts:434-460`) and `createProjectTool`. There is no separate admin-panel convention in this codebase to reuse instead (confirmed: only MCP tools and `tsx scripts/*.ts` dev scripts exist as manually-triggered patterns), so four new tools mirroring that exact convention satisfy the brief's "narrowly scoped route accessible only through normal organization/project authorization" requirement without inventing a new access-control mechanism. This also serves as TB-001's minimal user-facing surface (brief's preference order item 3: "developer/server-function output" — appropriate here since a dashboard UI would be out-of-scope work per the brief).

**Tenant safety:** every handler is wrapped in `withMcpProjectAuth`, which — before the handler runs — resolves the caller's organization from the token and asserts the given `projectId` belongs to it (`requireProjectAccess`, `src/server/mcp/project-auth.ts:44-53`), throwing `FORBIDDEN` otherwise. No new authorization logic is introduced; Task 13's tests prove this existing gate covers the new tools.

- [ ] **Step 1: Implement the MCP tools**

```ts
// src/server/mcp/tools/trendbrief-tools.ts
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { TrendbriefAnalysisService } from "@/server/features/trendbrief/services/TrendbriefAnalysisService";
import { TrendbriefOpportunityLifecycleService } from "@/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService";
import { TrendbriefOutcomeService } from "@/server/features/trendbrief/services/TrendbriefOutcomeService";
import { TrendbriefOpportunityRepository } from "@/server/features/trendbrief/repositories/TrendbriefOpportunityRepository";
import { TrendbriefRecommendationRepository } from "@/server/features/trendbrief/repositories/TrendbriefRecommendationRepository";
import { TRENDBRIEF_OPPORTUNITY_STATUSES } from "@/server/features/trendbrief/domain/types";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Inclusive YYYY-MM-DD date. Provide both start and end.");

// --- analyze_trendbrief_opportunities ---------------------------------------

const analyzeInputSchema = z.strictObject({
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
});
type AnalyzeArgs = z.infer<typeof analyzeInputSchema>;

export const analyzeTrendbriefOpportunitiesTool = {
  name: "analyze_trendbrief_opportunities",
  config: {
    title: "Analyze TrendBrief opportunities",
    description:
      "Ingest Search Console evidence for a project, run the deterministic GSC striking-distance detector, and persist/update scored opportunities with a grounded recommendation. No LLM call; no paid provider calls (Search Console is free). Re-running with the same evidence updates existing opportunities instead of duplicating them.",
    inputSchema: analyzeInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: AnalyzeArgs, context): Promise<CallToolResult> => {
    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
      startDate: args.startDate,
      endDate: args.endDate,
    });
    return mcpResponse({
      text:
        `Analysis complete: ${result.evidenceIngested} evidence rows ingested, ` +
        `${result.opportunitiesDetected} candidates detected ` +
        `(${result.opportunitiesCreated} new, ${result.opportunitiesUpdated} updated).`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: result,
    });
  }),
};

// --- list_trendbrief_opportunities -------------------------------------------

const listInputSchema = z.strictObject({
  projectId: projectIdSchema,
  status: z.enum(TRENDBRIEF_OPPORTUNITY_STATUSES).optional(),
});
type ListArgs = z.infer<typeof listInputSchema>;

export const listTrendbriefOpportunitiesTool = {
  name: "list_trendbrief_opportunities",
  config: {
    title: "List TrendBrief opportunities",
    description:
      "List a project's TrendBrief opportunities (priority-ordered), each with its deterministic recommendation and detection rationale. Read-only.",
    inputSchema: listInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: ListArgs, context): Promise<CallToolResult> => {
    const opportunities = await TrendbriefOpportunityRepository.listForProject(args.projectId);
    const filtered = args.status
      ? opportunities.filter((opportunity) => opportunity.status === args.status)
      : opportunities;

    const rows = await Promise.all(
      filtered.map(async (opportunity) => {
        const recommendation = await TrendbriefRecommendationRepository.getByOpportunityId(opportunity.id);
        return {
          id: opportunity.id,
          type: opportunity.type,
          subjectUrl: opportunity.subjectUrl,
          subjectQuery: opportunity.subjectQuery,
          status: opportunity.status,
          priorityScore: opportunity.priorityScore,
          confidenceScore: opportunity.confidenceScore,
          impactScore: opportunity.impactScore,
          effortScore: opportunity.effortScore,
          relevanceStatus: opportunity.relevanceStatus,
          rationaleCodes: JSON.parse(opportunity.rationaleCodes) as string[],
          firstDetectedAt: opportunity.firstDetectedAt,
          lastDetectedAt: opportunity.lastDetectedAt,
          recommendation: recommendation
            ? {
                groundedSummary: recommendation.groundedSummary,
                proposedAction: JSON.parse(recommendation.proposedAction),
              }
            : null,
        };
      }),
    );

    return mcpResponse({
      text: `${rows.length} TrendBrief opportunit${rows.length === 1 ? "y" : "ies"} for this project.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { rows },
    });
  }),
};

// --- set_trendbrief_opportunity_status ---------------------------------------

const setStatusInputSchema = z.strictObject({
  projectId: projectIdSchema,
  opportunityId: z.string().min(1),
  action: z.enum(["accept", "reject", "complete"]),
  notes: z.string().optional(),
});
type SetStatusArgs = z.infer<typeof setStatusInputSchema>;

export const setTrendbriefOpportunityStatusTool = {
  name: "set_trendbrief_opportunity_status",
  config: {
    title: "Accept, reject, or complete a TrendBrief opportunity",
    description:
      "Record the operator's decision on a TrendBrief opportunity: accept (detected -> accepted), reject (detected -> rejected), or complete (accepted -> completed). Invalid transitions are rejected.",
    inputSchema: setStatusInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: SetStatusArgs, context): Promise<CallToolResult> => {
    const transitionInput = {
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      actor: context.auth.userId,
      notes: args.notes,
    };
    const opportunity =
      args.action === "accept"
        ? await TrendbriefOpportunityLifecycleService.acceptOpportunity(transitionInput)
        : args.action === "reject"
          ? await TrendbriefOpportunityLifecycleService.rejectOpportunity(transitionInput)
          : await TrendbriefOpportunityLifecycleService.completeOpportunity(transitionInput);

    return mcpResponse({
      text: `Opportunity ${opportunity.id} is now "${opportunity.status}".`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { opportunity },
    });
  }),
};

// --- record_trendbrief_outcome ------------------------------------------------

const windowSchema = z.object({ start: dateSchema, end: dateSchema });
const recordOutcomeInputSchema = z.strictObject({
  projectId: projectIdSchema,
  opportunityId: z.string().min(1),
  baselineWindow: windowSchema,
  comparisonWindow: windowSchema,
});
type RecordOutcomeArgs = z.infer<typeof recordOutcomeInputSchema>;

export const recordTrendbriefOutcomeTool = {
  name: "record_trendbrief_outcome",
  config: {
    title: "Record a TrendBrief opportunity outcome",
    description:
      "Compare a TrendBrief opportunity's baseline and comparison Search Console windows and record a correlational classification (improved/unchanged/declined/inconclusive). Never asserts causation.",
    inputSchema: recordOutcomeInputSchema,
    outputSchema: looseObjectOutputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: RecordOutcomeArgs, context): Promise<CallToolResult> => {
    const outcome = await TrendbriefOutcomeService.recordOutcome({
      organizationId: context.auth.organizationId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      baselineWindow: args.baselineWindow,
      comparisonWindow: args.comparisonWindow,
    });
    return mcpResponse({
      text: `Outcome recorded: ${outcome.classification}.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { outcome },
    });
  }),
};
```

- [ ] **Step 2: Write the failing tenant-authorization and behavior tests**

```ts
// src/server/mcp/tools/trendbrief-tools.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeTrendbriefOpportunitiesTool,
  listTrendbriefOpportunitiesTool,
  setTrendbriefOpportunityStatusTool,
} from "./trendbrief-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  analyzeProject: vi.fn(),
  listForProject: vi.fn(),
  getByOpportunityId: vi.fn(),
  acceptOpportunity: vi.fn(),
}));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: { getProjectForOrganization: mocks.getProjectForOrganization },
}));
vi.mock("@/server/features/trendbrief/services/TrendbriefAnalysisService", () => ({
  TrendbriefAnalysisService: { analyzeProject: mocks.analyzeProject },
}));
vi.mock("@/server/features/trendbrief/repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { listForProject: mocks.listForProject },
}));
vi.mock("@/server/features/trendbrief/repositories/TrendbriefRecommendationRepository", () => ({
  TrendbriefRecommendationRepository: { getByOpportunityId: mocks.getByOpportunityId },
}));
vi.mock("@/server/features/trendbrief/services/TrendbriefOpportunityLifecycleService", () => ({
  TrendbriefOpportunityLifecycleService: {
    acceptOpportunity: mocks.acceptOpportunity,
    rejectOpportunity: vi.fn(),
    completeOpportunity: vi.fn(),
  },
}));

const toolContext = makeToolContext();

describe("TrendBrief MCP tools — tenant authorization", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockReset();
    mocks.analyzeProject.mockReset();
    mocks.listForProject.mockReset();
    mocks.getByOpportunityId.mockReset();
    mocks.acceptOpportunity.mockReset();
  });

  it("rejects analyze_trendbrief_opportunities for a project outside the caller's organization, without touching the analysis service", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      analyzeTrendbriefOpportunitiesTool.handler({ projectId: "project_other_org" }, toolContext),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.analyzeProject).not.toHaveBeenCalled();
  });

  it("rejects list_trendbrief_opportunities for a project outside the caller's organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      listTrendbriefOpportunitiesTool.handler({ projectId: "project_other_org" }, toolContext),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.listForProject).not.toHaveBeenCalled();
  });

  it("rejects set_trendbrief_opportunity_status for a project outside the caller's organization — guessing an opportunityId does not bypass the project check", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      setTrendbriefOpportunityStatusTool.handler(
        { projectId: "project_other_org", opportunityId: "opp_guessed", action: "accept" },
        toolContext,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.acceptOpportunity).not.toHaveBeenCalled();
  });

  it("proceeds when the project belongs to the caller's organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1", organizationId: "org_123" });
    mocks.analyzeProject.mockResolvedValue({
      evidenceIngested: 2,
      opportunitiesDetected: 1,
      opportunitiesCreated: 1,
      opportunitiesUpdated: 0,
    });

    const result = await analyzeTrendbriefOpportunitiesTool.handler({ projectId: "project_1" }, toolContext);

    expect(mocks.analyzeProject).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_123", projectId: "project_1" }),
    );
    expect(result.structuredContent?.opportunitiesCreated).toBe(1);
  });
});

describe("list_trendbrief_opportunities", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1", organizationId: "org_123" });
    mocks.listForProject.mockReset();
    mocks.getByOpportunityId.mockReset();
  });

  it("filters by status when provided", async () => {
    mocks.listForProject.mockResolvedValue([
      { id: "opp_1", status: "detected", rationaleCodes: "[]", priorityScore: 50 },
      { id: "opp_2", status: "accepted", rationaleCodes: "[]", priorityScore: 40 },
    ]);
    mocks.getByOpportunityId.mockResolvedValue(null);

    const result = await listTrendbriefOpportunitiesTool.handler(
      { projectId: "project_1", status: "accepted" },
      toolContext,
    );

    expect(result.structuredContent?.rows).toHaveLength(1);
    expect((result.structuredContent?.rows as Array<{ id: string }>)[0]!.id).toBe("opp_2");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/server/mcp/tools/trendbrief-tools.test.ts`
Expected: FAIL with "Cannot find module './trendbrief-tools'"

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/mcp/tools/trendbrief-tools.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Register the four tools in the MCP server**

In `src/server/mcp/server.ts`, add an import next to the other tool-file imports:

```ts
import {
  analyzeTrendbriefOpportunitiesTool,
  listTrendbriefOpportunitiesTool,
  setTrendbriefOpportunityStatusTool,
  recordTrendbriefOutcomeTool,
} from "./tools/trendbrief-tools";
```

And add four lines after `register(getGoogleAnalyticsKeyEventsTool);` (or the last existing `register(...)` call):

```ts
  register(analyzeTrendbriefOpportunitiesTool);
  register(listTrendbriefOpportunitiesTool);
  register(setTrendbriefOpportunityStatusTool);
  register(recordTrendbriefOutcomeTool);
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/mcp/tools/trendbrief-tools.ts src/server/mcp/tools/trendbrief-tools.test.ts src/server/mcp/server.ts
git commit -m "feat(trendbrief): add MCP tool surface for analyze/list/status/outcome"
```

---

### Task 14: Architecture decision record

**Files:**
- Create: `specs/0012-trendbrief-opportunity-domain.md`

**Interfaces:** none — documentation only, following the exact section structure of `specs/0003-google-search-console-integration.md` (`## Status` / `## Context` / `## Decision` / `## Rationale` / `## Consequences`).

- [ ] **Step 1: Write the ADR**

```md
# TrendBrief evidence-driven opportunity domain (TB-001)

## Status

Accepted

## Context

OpenSEO exposes SEO measurements and research tools (GSC, GA4, DataForSEO) but has no durable, persisted "opportunity" concept — `SearchOpportunityService` (`src/server/features/ga4/services/SearchOpportunityService.ts`) computes a scored, joined GSC/GA4 view on every call and persists nothing. TrendBrief needs a decision-and-workflow layer above OpenSEO's acquisition layer: given real SEO evidence, identify a useful opportunity deterministically, explain exactly why it exists, remember what the user decided, and lay the foundation for measuring what happened afterwards. TB-001 is the first vertical slice proving that loop end to end for one opportunity type: a GSC striking-distance opportunity (a page/query already receiving impressions, ranking close enough to strong visibility that improving the page may beat creating new content).

## Decision

Add a new `src/server/features/trendbrief/` domain layer (`domain/`, `scoring/`, `repositories/`, `services/`, `detectors/`) and six new tables (`trendbrief_evidence`, `trendbrief_opportunities`, `trendbrief_opportunity_evidence`, `trendbrief_recommendations`, `trendbrief_actions`, `trendbrief_outcomes`), hand-written for both D1 and Postgres and guarded by the existing `schema-parity.test.ts`.

**Evidence first.** Evidence is a normalized, machine-readable measurement (currently GSC page+query performance only) with a deduplication key covering the observation window, so re-ingesting the same window is idempotent. An opportunity can only be created from persisted evidence, and the `trendbrief_opportunity_evidence` join table lets a reviewer trace every opportunity back to the exact rows that produced it. Source lineage beyond `source`/`evidenceType`/the observation window is resolved via the project's single GSC connection (`gsc_connections`, unique per project) rather than duplicated onto every evidence row — a project has at most one connected property at a time, so `projectId` alone is enough to look up which Search Console property an evidence row came from.

**Deterministic detection, versioned.** The first (and only, for TB-001) detector — `gsc-striking-distance:v1` — is a pure function over persisted evidence: no LLM call decides whether something is a good opportunity. Detector identity (`detectorId` + `detectorVersion`) is persisted on every opportunity row, so a future scoring change is distinguishable from a past decision.

**Idempotent re-detection.** An opportunity's dedupe key (organization + project + detector key + subject page/query) deliberately excludes the observation window, so re-running the detector daily updates one row (`lastDetectedAt`, scores) instead of creating a new one — and never silently reverts a human decision (`accepted`/`rejected`/etc.) back to `detected`.

**Deterministic recommendation, AI-enrichable later.** Each opportunity gets exactly one recommendation row, entirely templated from measured fields (page, rationale codes, suggested next analysis) — `generationMethod: "deterministic"`. The schema has room for a future AI-authored explanation (a version bump, or a future `generationMethod: "llm"` row) without changing this baseline.

**Commercial relevance reuses existing structured data.** Rather than building a new relevance model, the detector matches a candidate's subject URL against the project's existing, human-curated `project_key_pages` list (`ProjectContextRepository.listKeyPages`). A match marks `relevanceStatus: "confirmed"`; no match marks it `"unconfirmed"` (not rejected) — the opportunity is still created, with a lower confidence and priority score, rather than pretending certainty the data doesn't support.

**Inspectable scoring.** `priority = demand x reachability x businessRelevance x confidence x (1 - effort)`, with every component persisted on the opportunity row and every threshold a named constant in `scoring/constants.ts`. Confidence blends evidence freshness, sample size (impressions), relevance confirmation, and (currently unused, single-source) source agreement.

**Explicit tenant ownership.** Every new table carries both `organization_id` and `project_id`; every repository read/update takes an explicit `projectId` filter (`getForProject`, `listForProject`, `updateStatus`), so a guessed opportunity ID belonging to a different project returns nothing. The MCP tool surface (`analyze_trendbrief_opportunities`, `list_trendbrief_opportunities`, `set_trendbrief_opportunity_status`, `record_trendbrief_outcome`) reuses the existing `withMcpProjectAuth` gate — no new authorization mechanism.

**No LLM, no new paid calls.** The entire slice — evidence collection, detection, scoring, recommendation, lifecycle, outcome — runs without an LLM API call or a DataForSEO call. Evidence collection is a thin adapter over the existing, free `GscService.getPerformance`.

## Rationale

Reusing `GscService.getPerformance` and `ProjectContextRepository.listKeyPages` instead of building new integrations keeps this a genuinely minimal vertical slice and avoids introducing a second GSC client or a second "what pages matter" concept. Mirroring the existing MCP-tool convention for the execution route (rather than inventing an admin panel) matches how every other manually-triggered, project-scoped action in this codebase already works. Excluding the observation window from the opportunity (but not the evidence) dedupe key is the specific design choice that makes "re-running the detector doesn't duplicate opportunities" true without adding a separate reconciliation step.

## Consequences

- Evidence volume is bounded to striking-distance rows only (position 4-20); non-qualifying GSC rows are never persisted, so re-running analysis daily does not accumulate unbounded evidence.
- A project with no `project_key_pages` entries will have every opportunity's relevance marked `unconfirmed`, lowering its confidence/priority even for genuinely commercially relevant pages — a known false-negative risk the brief explicitly permits over inventing an unverified relevance signal.
- `trendbrief_opportunities.status` models `expired`/`superseded` (and the `completed -> measuring -> {successful,inconclusive,unsuccessful}` chain) as recognized values, but TB-001 does not implement the automatic transitions into them — `expiresAt` is stored but nothing currently reads it, and `record_trendbrief_outcome` writes an outcome without forcing the opportunity through `measuring` first. A future slice should decide whether the outcome recording itself should drive that transition.
- `TrendbriefOpportunityRepository.upsertFromDetection` and `TrendbriefOpportunityLifecycleService`'s status+action writes are sequential, non-atomic writes, not wrapped in `runBatch` (`src/db/runBatch.ts`). Acceptable for TB-001's single-operator execution model; a concurrent-writer or scheduled-production version of this slice should wrap both in a transaction.
- New TrendBrief capabilities should extend `src/server/features/trendbrief/` and its four MCP tools, keeping detection deterministic and evidence-traceable, per the principles above.
```

- [ ] **Step 2: Commit**

```bash
git add specs/0012-trendbrief-opportunity-domain.md
git commit -m "docs(trendbrief): add TB-001 architecture decision record"
```

---

### Task 15: Full verification pass and unrelated-work protection

**Files:** none created — this task runs the repository's validation suite and reviews the accumulated diff.

- [ ] **Step 1: Run formatting check**

Run: `npx prettier --check src/db/trendbrief.schema.ts src/db/pg/trendbrief.schema.ts src/db/schema.ts src/db/d1/schema.ts src/db/pg/schema.ts src/db/schema-parity.test.ts src/server/features/trendbrief src/server/mcp/tools/trendbrief-tools.ts src/server/mcp/tools/trendbrief-tools.test.ts src/server/mcp/server.ts specs/0012-trendbrief-opportunity-domain.md`
Expected: all listed files report as already formatted. If any file is flagged, run `npx prettier --write <file>` and re-run the check.

- [ ] **Step 2: Type-check the whole repository**

Run: `npx tsc --noEmit`
Expected: PASS with no errors attributable to the new `trendbrief` code or the modified schema/MCP-server files. If a pre-existing unrelated error appears, confirm it also occurs on a clean checkout of `HEAD~<n>` (before this branch's commits) before treating it as pre-existing, and report it rather than fixing it.

- [ ] **Step 3: Lint**

Run: `npx oxlint . --type-aware`
Expected: no new findings in `src/db/trendbrief.schema.ts`, `src/db/pg/trendbrief.schema.ts`, `src/server/features/trendbrief/**`, or `src/server/mcp/tools/trendbrief-tools.ts`.

- [ ] **Step 4: Run the full TrendBrief-targeted test suite**

Run: `npx vitest run src/server/features/trendbrief src/server/mcp/tools/trendbrief-tools.test.ts`
Expected: PASS — all tests from Tasks 2-13 (domain, scoring, repositories, services, detector, MCP tools).

- [ ] **Step 5: Run the schema-parity and existing GSC/GA4 regression suites**

Run: `npx vitest run src/db/schema-parity.test.ts src/server/features/gsc src/server/features/ga4`
Expected: PASS — proves existing GSC/GA4 functionality (including `SearchOpportunityService`) is unmodified and still passing, satisfying acceptance criterion 12.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:ci`
Expected: PASS. If any failure is unrelated to this branch's changes (a file this plan never touched), capture the failing test name and confirm it also fails on `main` before this branch's commits (e.g. `git stash && npx vitest run <failing test file> ; git stash pop`), then report it as pre-existing rather than fixing it.

- [ ] **Step 7: Review the accumulated diff for unrelated work**

Run: `git status --porcelain` and `git diff main...HEAD --stat`
Expected: every changed/created file is one of: the six `trendbrief_*` schema/barrel/parity files (Task 1), `src/server/features/trendbrief/**` (Tasks 2-12), `src/server/mcp/tools/trendbrief-tools.ts` + `.test.ts` + the `src/server/mcp/server.ts` registration edit (Task 13), `specs/0012-trendbrief-opportunity-domain.md` (Task 14), and the generated `drizzle/`/`drizzle-pg/` migration files (Task 1). No other file should appear. If anything else appears, investigate before proceeding — do not discard it blindly (it may be pre-existing work from before this plan started).

- [ ] **Step 8: Confirm no new paid-provider calls were introduced**

Run: `grep -rn "dataforseo" src/server/features/trendbrief`
Expected: no matches.

- [ ] **Step 9: Push**

This repository has no branch-protection/PR-required convention evident in-repo (no CI workflow file or CONTRIBUTING.md requirement found gating direct pushes to `main` for this fork). Push the completed, verified commits:

```bash
git push origin main
```

If this push is rejected (e.g. by a remote rule not visible locally), stop and report the exact rejection reason rather than force-pushing or bypassing it.


