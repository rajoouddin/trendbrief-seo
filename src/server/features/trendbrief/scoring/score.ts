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
