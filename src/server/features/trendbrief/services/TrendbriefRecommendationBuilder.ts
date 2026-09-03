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
