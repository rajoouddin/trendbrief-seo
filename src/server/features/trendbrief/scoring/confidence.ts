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
export function computeRelevanceComponent(
  status: TrendbriefRelevanceStatus,
): number {
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
