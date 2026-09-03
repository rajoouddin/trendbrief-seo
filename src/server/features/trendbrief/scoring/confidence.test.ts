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
      {
        observationEndDate: "2026-08-30",
        impressions: 200,
        relevanceStatus: "confirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    const stale = computeConfidenceScore(
      {
        observationEndDate: "2026-07-01",
        impressions: 200,
        relevanceStatus: "confirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    expect(stale).toBeLessThan(fresh);
  });

  it("is lower for a small impression sample than a large one, all else equal", () => {
    const small = computeConfidenceScore(
      {
        observationEndDate: "2026-08-30",
        impressions: 5,
        relevanceStatus: "confirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    const large = computeConfidenceScore(
      {
        observationEndDate: "2026-08-30",
        impressions: 5_000,
        relevanceStatus: "confirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    expect(small).toBeLessThan(large);
  });

  it("is lower when commercial relevance is unconfirmed than when confirmed, all else equal", () => {
    const unconfirmed = computeConfidenceScore(
      {
        observationEndDate: "2026-08-30",
        impressions: 500,
        relevanceStatus: "unconfirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    const confirmed = computeConfidenceScore(
      {
        observationEndDate: "2026-08-30",
        impressions: 500,
        relevanceStatus: "confirmed",
        evidenceSourceCount: 1,
      },
      NOW,
    );
    expect(unconfirmed).toBeLessThan(confirmed);
  });

  it("stays within 0 and 1", () => {
    const score = computeConfidenceScore(
      {
        observationEndDate: "2020-01-01",
        impressions: 0,
        relevanceStatus: "unconfirmed",
        evidenceSourceCount: 1,
      },
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
