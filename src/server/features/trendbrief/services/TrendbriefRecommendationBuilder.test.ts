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
  scores: {
    demand: 0.6,
    reachability: 0.7,
    businessRelevance: 1,
    confidence: 0.8,
    effort: 0.2,
    priority: 67,
  },
  rationaleCodes: [
    "striking_distance",
    "meaningful_impressions",
    "healthy_ctr",
    "commercial_relevance_confirmed_money",
  ],
};

describe("buildDeterministicRecommendation", () => {
  it("proposes improving the existing page, carries the candidate's rationale codes verbatim, and does not invent content changes", () => {
    const recommendation = buildDeterministicRecommendation(candidate);
    expect(recommendation.proposedAction.page).toBe("/tree-removal-cheltenham");
    expect(recommendation.proposedAction.reasonCodes).toEqual(
      candidate.rationaleCodes,
    );
    expect(recommendation.proposedAction.suggestedNextAnalysis).toEqual([
      "inspect_ranking_serp",
      "inspect_page_content",
      "inspect_technical_audit",
    ]);
  });

  it("grounds the summary in the measured metrics, not an invented claim", () => {
    const recommendation = buildDeterministicRecommendation(candidate);
    expect(recommendation.groundedSummary).toContain(
      "/tree-removal-cheltenham",
    );
    expect(recommendation.groundedSummary).toContain("tree removal cheltenham");
    expect(recommendation.groundedSummary).toContain("400");
    expect(recommendation.groundedSummary).toContain("8");
  });
});
