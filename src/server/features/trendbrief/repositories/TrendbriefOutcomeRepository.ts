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
