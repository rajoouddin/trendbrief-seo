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
