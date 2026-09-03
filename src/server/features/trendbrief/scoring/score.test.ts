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
