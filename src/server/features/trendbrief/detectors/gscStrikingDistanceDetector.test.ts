import { describe, expect, it } from "vitest";
import { detectGscStrikingDistanceCandidates } from "./gscStrikingDistanceDetector";
import type { TrendbriefEvidence } from "../repositories/TrendbriefEvidenceRepository";

const NOW = new Date("2026-09-01T00:00:00.000Z");

function evidenceRow(overrides: Partial<Omit<TrendbriefEvidence, "metrics">> & { metrics?: object } = {}): TrendbriefEvidence {
  const { metrics: metricsOverride, ...restOverrides } = overrides;
  return {
    id: "evidence_1",
    organizationId: "org_1",
    projectId: "project_1",
    source: "gsc",
    evidenceType: "gsc_page_query_performance",
    subjectUrl: "/tree-removal-cheltenham",
    subjectQuery: "tree removal cheltenham",
    observationStart: "2026-08-01",
    observationEnd: "2026-08-28",
    dataState: "final",
    metrics: JSON.stringify({ clicks: 20, impressions: 400, ctr: 0.05, position: 8, ...metricsOverride }),
    dedupeKey: "dedupe_1",
    capturedAt: "2026-08-28T00:00:00.000Z",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...restOverrides,
  } as TrendbriefEvidence;
}

describe("detectGscStrikingDistanceCandidates", () => {
  it("produces a candidate for a qualifying page/query in the striking-distance range with meaningful impressions", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow()],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.subjectUrl).toBe("/tree-removal-cheltenham");
    expect(candidates[0]!.subjectQuery).toBe("tree removal cheltenham");
    expect(candidates[0]!.rationaleCodes).toContain("striking_distance");
  });

  it("does not produce a candidate when position is outside the configured range", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ metrics: { position: 25 } })],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });

  it("does not produce a candidate when impressions are below the configured threshold", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ metrics: { impressions: 5 } })],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });

  it("produces a candidate with low confidence (not zero candidates) for stale evidence", () => {
    const fresh = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ observationEnd: "2026-08-28" })],
      keyPages: [],
      now: NOW,
    })[0]!;
    const stale = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ observationEnd: "2026-06-01" })],
      keyPages: [],
      now: NOW,
    })[0]!;
    expect(stale.scores.confidence).toBeLessThan(fresh.scores.confidence);
  });

  it("marks relevance confirmed and raises businessRelevance/priority when the page matches a key page", () => {
    const withoutKeyPage = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow()],
      keyPages: [],
      now: NOW,
    })[0]!;
    const withKeyPage = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow()],
      keyPages: [{ url: "/tree-removal-cheltenham", role: "money", topic: "tree removal" }],
      now: NOW,
    })[0]!;
    expect(withoutKeyPage.relevanceStatus).toBe("unconfirmed");
    expect(withKeyPage.relevanceStatus).toBe("confirmed");
    expect(withKeyPage.scores.priority).toBeGreaterThan(withoutKeyPage.scores.priority);
  });

  it("skips evidence with no subjectQuery", () => {
    const candidates = detectGscStrikingDistanceCandidates({
      evidence: [evidenceRow({ subjectQuery: null })],
      keyPages: [],
      now: NOW,
    });
    expect(candidates).toHaveLength(0);
  });
});
