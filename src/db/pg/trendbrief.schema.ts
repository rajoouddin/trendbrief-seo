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
