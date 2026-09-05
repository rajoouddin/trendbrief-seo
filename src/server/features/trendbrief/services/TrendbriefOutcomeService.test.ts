import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOutcomeService } from "./TrendbriefOutcomeService";
import type { TrendbriefOutcomeRepository } from "../repositories/TrendbriefOutcomeRepository";

type RecordInput = Parameters<typeof TrendbriefOutcomeRepository.record>[0];
// The double below mirrors the repository's own hardcoded attributionNote
// (see the comment above the mockImplementation) rather than the full
// TrendbriefOutcome row shape, since that's all this file's assertions read.
type RecordResult = RecordInput & { id: string; attributionNote: string };

const mocks = vi.hoisted(() => ({
  getForProject: vi.fn(),
  getPerformance: vi.fn(),
  record: vi.fn<(input: RecordInput) => Promise<RecordResult>>(),
}));

vi.mock("../repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { getForProject: mocks.getForProject },
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
}));
vi.mock("../repositories/TrendbriefOutcomeRepository", () => ({
  TrendbriefOutcomeRepository: { record: mocks.record },
}));

const baseInput = {
  organizationId: "org_1",
  projectId: "project_1",
  opportunityId: "opp_1",
  baselineWindow: { start: "2026-08-01", end: "2026-08-28" },
  comparisonWindow: { start: "2026-09-01", end: "2026-09-28" },
};

describe("TrendbriefOutcomeService.recordOutcome", () => {
  beforeEach(() => {
    mocks.getForProject.mockReset();
    mocks.getPerformance.mockReset();
    mocks.record.mockReset();
    mocks.getForProject.mockResolvedValue({
      id: "opp_1",
      projectId: "project_1",
      organizationId: "org_1",
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
      status: "completed",
    });
    // Mirrors TrendbriefOutcomeRepository.record's real behavior: attributionNote
    // is hardcoded by the repository itself, independent of whatever the caller
    // passes in — record()'s input type doesn't even accept it. The mock must
    // simulate that fixed string here, or this double silently diverges from
    // the repository it stands in for.
    mocks.record.mockImplementation(async (input) => ({
      id: "outcome_1",
      attributionNote:
        "Performance changed after the recorded action; this reflects a correlation over time, not a proven causal effect.",
      ...input,
    }));
  });

  it("classifies as improved when position gets closer to page 1", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({
        rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 10 }],
      })
      .mockResolvedValueOnce({
        rows: [{ clicks: 25, impressions: 320, ctr: 0.078, position: 6 }],
      });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("improved");
  });

  it("classifies as declined when position moves further from page 1", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({
        rows: [{ clicks: 20, impressions: 300, ctr: 0.067, position: 6 }],
      })
      .mockResolvedValueOnce({
        rows: [{ clicks: 8, impressions: 280, ctr: 0.029, position: 12 }],
      });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("declined");
  });

  it("classifies conflicting signals (position collapses, clicks tick up slightly) as something other than improved", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({
        rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 6 }],
      })
      .mockResolvedValueOnce({
        rows: [{ clicks: 11, impressions: 300, ctr: 0.037, position: 15 }],
      });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("declined");
  });

  it("classifies as inconclusive when either window has no data", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 8 }],
      });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.classification).toBe("inconclusive");
  });

  it("never asserts a causal claim in the attribution note", async () => {
    mocks.getPerformance
      .mockResolvedValueOnce({
        rows: [{ clicks: 10, impressions: 300, ctr: 0.033, position: 10 }],
      })
      .mockResolvedValueOnce({
        rows: [{ clicks: 25, impressions: 320, ctr: 0.078, position: 6 }],
      });

    const outcome = await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(outcome.attributionNote.toLowerCase()).not.toContain("caused");
    expect(outcome.attributionNote.toLowerCase()).toContain("correlation");
  });

  it("throws NOT_FOUND for an opportunity outside the given project", async () => {
    mocks.getForProject.mockResolvedValue(null);

    await expect(
      TrendbriefOutcomeService.recordOutcome(baseInput),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.getPerformance).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each(["detected", "accepted", "rejected"])(
    "rejects a %s opportunity before querying GSC or persisting an outcome",
    async (status) => {
      mocks.getForProject.mockResolvedValue({
        id: "opp_1",
        organizationId: "org_1",
        projectId: "project_1",
        subjectUrl: "/tree-removal-cheltenham",
        subjectQuery: "tree removal cheltenham",
        status,
      });

      await expect(
        TrendbriefOutcomeService.recordOutcome(baseInput),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(mocks.getPerformance).not.toHaveBeenCalled();
      expect(mocks.record).not.toHaveBeenCalled();
    },
  );

  it("allows a completed opportunity and preserves its project and organization scope", async () => {
    mocks.getPerformance.mockResolvedValue({ rows: [] });

    await TrendbriefOutcomeService.recordOutcome(baseInput);

    expect(mocks.getForProject).toHaveBeenCalledWith("project_1", "opp_1");
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: "opp_1",
        organizationId: "org_1",
        projectId: "project_1",
      }),
    );
  });

  it.each([
    {
      label: "a reversed baseline window",
      baselineWindow: { start: "2026-08-28", end: "2026-08-01" },
      comparisonWindow: { start: "2026-09-01", end: "2026-09-28" },
    },
    {
      label: "a reversed comparison window",
      baselineWindow: { start: "2026-08-01", end: "2026-08-28" },
      comparisonWindow: { start: "2026-09-28", end: "2026-09-01" },
    },
    {
      label: "overlapping windows",
      baselineWindow: { start: "2026-08-01", end: "2026-08-28" },
      comparisonWindow: { start: "2026-08-28", end: "2026-09-20" },
    },
    {
      label: "a comparison window before the baseline",
      baselineWindow: { start: "2026-09-01", end: "2026-09-28" },
      comparisonWindow: { start: "2026-08-01", end: "2026-08-28" },
    },
    {
      label: "an impossible calendar date",
      baselineWindow: { start: "2026-02-30", end: "2026-03-01" },
      comparisonWindow: { start: "2026-03-02", end: "2026-03-28" },
    },
  ])("rejects $label before querying GSC", async (windows) => {
    await expect(
      TrendbriefOutcomeService.recordOutcome({ ...baseInput, ...windows }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.getPerformance).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("allows adjacent, non-overlapping calendar periods", async () => {
    mocks.getPerformance.mockResolvedValue({ rows: [] });

    await TrendbriefOutcomeService.recordOutcome({
      ...baseInput,
      baselineWindow: { start: "2026-08-01", end: "2026-08-28" },
      comparisonWindow: { start: "2026-08-29", end: "2026-09-28" },
    });

    expect(mocks.getPerformance).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenCalledOnce();
  });
});
