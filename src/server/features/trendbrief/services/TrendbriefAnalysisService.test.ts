import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefAnalysisService } from "./TrendbriefAnalysisService";

const mocks = vi.hoisted(() => ({
  collectGscStrikingDistanceEvidence: vi.fn(),
  listKeyPages: vi.fn(),
  upsertFromDetection: vi.fn(),
  linkEvidence: vi.fn(),
  upsertForOpportunity: vi.fn(),
}));

vi.mock("./TrendbriefEvidenceCollector", () => ({
  TrendbriefEvidenceCollector: { collectGscStrikingDistanceEvidence: mocks.collectGscStrikingDistanceEvidence },
}));
vi.mock("@/server/features/project-context/repositories/ProjectContextRepository", () => ({
  ProjectContextRepository: { listKeyPages: mocks.listKeyPages },
}));
vi.mock("../repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { upsertFromDetection: mocks.upsertFromDetection },
}));
vi.mock("../repositories/TrendbriefOpportunityEvidenceRepository", () => ({
  TrendbriefOpportunityEvidenceRepository: { linkEvidence: mocks.linkEvidence },
}));
vi.mock("../repositories/TrendbriefRecommendationRepository", () => ({
  TrendbriefRecommendationRepository: { upsertForOpportunity: mocks.upsertForOpportunity },
}));

const qualifyingEvidenceRow = {
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
  metrics: JSON.stringify({ clicks: 20, impressions: 400, ctr: 0.05, position: 8 }),
  dedupeKey: "evidence_dedupe_1",
  capturedAt: "2026-08-28T00:00:00.000Z",
  createdAt: "2026-08-28T00:00:00.000Z",
};

describe("TrendbriefAnalysisService.analyzeProject", () => {
  beforeEach(() => {
    mocks.collectGscStrikingDistanceEvidence.mockReset();
    mocks.listKeyPages.mockReset();
    mocks.upsertFromDetection.mockReset();
    mocks.linkEvidence.mockReset();
    mocks.upsertForOpportunity.mockReset();

    mocks.collectGscStrikingDistanceEvidence.mockResolvedValue({
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
      rowsConsidered: 1,
      rowsInStrikingDistance: 1,
      evidence: [qualifyingEvidenceRow],
    });
    mocks.listKeyPages.mockResolvedValue([]);
    mocks.linkEvidence.mockResolvedValue(undefined);
    mocks.upsertForOpportunity.mockResolvedValue({ id: "rec_1", version: 1 });
  });

  it("creates a new opportunity, links evidence, and writes a deterministic recommendation on first analysis", async () => {
    mocks.upsertFromDetection.mockResolvedValue({
      opportunity: { id: "opp_1", status: "detected" },
      wasNew: true,
    });

    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.evidenceIngested).toBe(1);
    expect(result.opportunitiesDetected).toBe(1);
    expect(result.opportunitiesCreated).toBe(1);
    expect(result.opportunitiesUpdated).toBe(0);
    expect(mocks.upsertFromDetection).toHaveBeenCalledTimes(1);
    expect(mocks.linkEvidence).toHaveBeenCalledWith("opp_1", ["evidence_1"]);
    expect(mocks.upsertForOpportunity).toHaveBeenCalledTimes(1);
    const detectionArgs = mocks.upsertFromDetection.mock.calls[0][0];
    expect(detectionArgs.detectorId).toBe("gsc-striking-distance");
    expect(detectionArgs.detectorVersion).toBe("v1");
  });

  it("re-running analysis with identical evidence updates the existing opportunity instead of creating a second one", async () => {
    mocks.upsertFromDetection.mockResolvedValue({
      opportunity: { id: "opp_1", status: "detected" },
      wasNew: false,
    });

    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.opportunitiesCreated).toBe(0);
    expect(result.opportunitiesUpdated).toBe(1);
    expect(mocks.upsertFromDetection).toHaveBeenCalledTimes(1);
  });

  it("does not detect or persist anything when no evidence qualifies", async () => {
    mocks.collectGscStrikingDistanceEvidence.mockResolvedValue({
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
      rowsConsidered: 0,
      rowsInStrikingDistance: 0,
      evidence: [],
    });

    const result = await TrendbriefAnalysisService.analyzeProject({
      organizationId: "org_1",
      projectId: "project_1",
    });

    expect(result.opportunitiesDetected).toBe(0);
    expect(mocks.upsertFromDetection).not.toHaveBeenCalled();
  });
});
