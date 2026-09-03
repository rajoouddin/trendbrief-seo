import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefEvidenceCollector } from "./TrendbriefEvidenceCollector";

const mocks = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));
vi.mock("../repositories/TrendbriefEvidenceRepository", () => ({
  TrendbriefEvidenceRepository: { upsert: mocks.upsert },
}));

describe("TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence", () => {
  beforeEach(() => {
    mocks.getPerformance.mockReset();
    mocks.upsert.mockReset();
    mocks.upsert.mockImplementation(async (input) => ({
      id: `evidence_${input.subjectUrl}_${input.subjectQuery}`,
      ...input,
      metrics: JSON.stringify(input.metrics),
    }));
  });

  it("persists only rows within the striking-distance position range, with a page+query key", async () => {
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: "user@example.com",
      request: { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["page", "query"] },
      rows: [
        { keys: ["/page-a", "query a"], clicks: 5, impressions: 300, ctr: 0.017, position: 8 },
        { keys: ["/page-b", "query b"], clicks: 50, impressions: 900, ctr: 0.055, position: 2 },
        { keys: ["/page-c", "query c"], clicks: 1, impressions: 40, ctr: 0.025, position: 25 },
      ],
    });

    const result = await TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.rowsConsidered).toBe(3);
    expect(result.rowsInStrikingDistance).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const upsertInput = mocks.upsert.mock.calls[0][0];
    expect(upsertInput.subjectUrl).toBe("/page-a");
    expect(upsertInput.subjectQuery).toBe("query a");
    expect(upsertInput.organizationId).toBe("org_1");
    expect(upsertInput.projectId).toBe("project_1");
    expect(upsertInput.observationStart).toBe("2026-08-01");
    expect(upsertInput.observationEnd).toBe("2026-08-28");
  });

  it("skips a row with fewer than two dimension keys (no query dimension)", async () => {
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: null,
      request: { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["page", "query"] },
      rows: [{ keys: ["/page-only"], clicks: 1, impressions: 100, ctr: 0.01, position: 10 }],
    });

    const result = await TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.evidence).toHaveLength(0);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("calls GscService.getPerformance with the page+query dimensions and the project scope", async () => {
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      connectedBy: null,
      request: { startDate: "2026-08-01", endDate: "2026-08-28", dimensions: ["page", "query"] },
      rows: [],
    });

    await TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence({
      organizationId: "org_1",
      projectId: "project_1",
      startDate: "2026-08-01",
      endDate: "2026-08-28",
    });

    expect(mocks.getPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        dimensions: ["page", "query"],
        startDate: "2026-08-01",
        endDate: "2026-08-28",
        type: "web",
        dataState: "final",
      }),
    );
  });
});
