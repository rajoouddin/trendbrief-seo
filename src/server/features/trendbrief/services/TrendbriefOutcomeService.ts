import { GscService } from "@/server/features/gsc/services/GscService";
import { AppError } from "@/server/lib/errors";
import type { GscSearchAnalyticsRow } from "@/server/lib/gscClient";
import type { TrendbriefOutcomeClassification } from "../domain/types";
import {
  outcomeWindowsSchema,
  type OutcomeWindows,
} from "../domain/outcomeWindows";
import { TrendbriefOpportunityRepository } from "../repositories/TrendbriefOpportunityRepository";
import {
  TrendbriefOutcomeRepository,
  type OutcomeMetrics,
  type TrendbriefOutcome,
} from "../repositories/TrendbriefOutcomeRepository";
import {
  OUTCOME_IMPROVEMENT_POSITION_THRESHOLD,
  SAMPLE_SIZE_CONFIDENCE_CEILING,
} from "../scoring/constants";
import { roundComponent } from "../scoring/util";

export type RecordOutcomeInput = OutcomeWindows & {
  organizationId: string;
  projectId: string;
  opportunityId: string;
};

function summarizeRows(rows: GscSearchAnalyticsRow[]): OutcomeMetrics {
  const row = rows[0];
  if (!row)
    return {
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: null,
      hasData: false,
    };
  return {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    hasData: true,
  };
}

// Lower position number = closer to page 1 = better. positionDelta > 0 means
// the comparison window ranks BETTER than baseline.
function classifyOutcome(
  baseline: OutcomeMetrics,
  comparison: OutcomeMetrics,
): TrendbriefOutcomeClassification {
  if (!baseline.hasData || !comparison.hasData) return "inconclusive";
  if (baseline.position === null || comparison.position === null)
    return "inconclusive";
  const positionDelta = baseline.position - comparison.position;
  const clicksDelta = comparison.clicks - baseline.clicks;
  // Position and clicks can disagree (e.g. position collapses while clicks
  // tick up slightly). Neither direction may claim "improved"/"declined" off
  // one signal alone when the other signal moved past the threshold the
  // opposite way in the same comparison.
  const positionImproved =
    positionDelta >= OUTCOME_IMPROVEMENT_POSITION_THRESHOLD;
  const positionWorsened =
    positionDelta <= -OUTCOME_IMPROVEMENT_POSITION_THRESHOLD;
  if (positionImproved && !positionWorsened) return "improved";
  if (clicksDelta > 0 && !positionWorsened) return "improved";
  if (positionWorsened && !positionImproved) return "declined";
  if (clicksDelta < 0 && !positionImproved) return "declined";
  return "unchanged";
}

function computeOutcomeConfidence(
  baseline: OutcomeMetrics,
  comparison: OutcomeMetrics,
): number {
  if (!baseline.hasData || !comparison.hasData) return 0;
  const sampleSize = Math.min(baseline.impressions, comparison.impressions);
  return roundComponent(
    Math.min(1, sampleSize / SAMPLE_SIZE_CONFIDENCE_CEILING),
  );
}

async function recordOutcome(
  input: RecordOutcomeInput,
): Promise<TrendbriefOutcome> {
  const windows = outcomeWindowsSchema.safeParse({
    baselineWindow: input.baselineWindow,
    comparisonWindow: input.comparisonWindow,
  });
  if (!windows.success) {
    throw new AppError("VALIDATION_ERROR", windows.error.issues[0]?.message);
  }

  const opportunity = await TrendbriefOpportunityRepository.getForProject(
    input.projectId,
    input.opportunityId,
  );
  if (!opportunity) throw new AppError("NOT_FOUND");
  if (opportunity.status !== "completed") {
    throw new AppError(
      "VALIDATION_ERROR",
      "An outcome can only be recorded after the opportunity action is completed.",
    );
  }

  const exactMatchFilters = [
    {
      dimension: "page" as const,
      operator: "equals" as const,
      expression: opportunity.subjectUrl,
    },
    {
      dimension: "query" as const,
      operator: "equals" as const,
      expression: opportunity.subjectQuery,
    },
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
    organizationId: opportunity.organizationId,
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
