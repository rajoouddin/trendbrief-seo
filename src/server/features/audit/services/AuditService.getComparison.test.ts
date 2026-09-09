import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuditForProjectMock,
  getPreviousCompletedAuditMock,
  getIssuesForAuditMock,
} = vi.hoisted(() => ({
  getAuditForProjectMock: vi.fn(),
  getPreviousCompletedAuditMock: vi.fn(),
  getIssuesForAuditMock: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    getAuditForProject: getAuditForProjectMock,
    getPreviousCompletedAuditForProject: getPreviousCompletedAuditMock,
    getIssuesForAudit: getIssuesForAuditMock,
  },
}));
vi.mock("@/server/features/audit/AuditScratchpad", () => ({
  getAuditScratchpad: vi.fn(),
}));
vi.mock("@/server/lib/audit/progress-kv", () => ({ AuditProgressKV: {} }));

import { AuditService } from "@/server/features/audit/services/AuditService";

function audit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "audit-2",
    projectId: "project-1",
    startedByUserId: "user-1",
    startUrl: "https://example.com/",
    status: "completed",
    workflowInstanceId: "wf-2",
    config: '{"maxPages":50,"lighthouseStrategy":"none"}',
    pagesCrawled: 40,
    pagesTotal: 40,
    lighthouseTotal: 0,
    lighthouseCompleted: 0,
    lighthouseFailed: 0,
    currentPhase: "completed",
    errorCode: null,
    errorDetail: null,
    failedPhase: null,
    startedAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:01:00.000Z",
    ...overrides,
  };
}

const PREVIOUS = audit({
  id: "audit-1",
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T00:01:00.000Z",
  pagesCrawled: 40,
});

const issue = (issueType: string, pageUrl: string) => ({
  id: `${issueType}:${pageUrl}`,
  pageId: pageUrl,
  pageUrl,
  issueType,
  severity: "warning",
  detailsJson: null,
  auditId: "audit-1",
});

describe("AuditService.getComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getIssuesForAuditMock.mockReturnValue([]);
  });

  it("fails on an audit outside the requested project (NOT_FOUND)", async () => {
    getAuditForProjectMock.mockResolvedValue(null);

    await expect(
      AuditService.getComparison("audit-2", "project-1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The scoping happens at the repository layer (projectId is always passed).
    expect(getAuditForProjectMock).toHaveBeenCalledWith("audit-2", "project-1");
  });

  it("returns incomplete when the current audit is still running or failed", async () => {
    getAuditForProjectMock.mockResolvedValue(
      audit({ status: "running", config: undefined }),
    );
    await expect(
      AuditService.getComparison("audit-2", "project-1"),
    ).resolves.toMatchObject({ comparable: false, reason: "incomplete" });

    getAuditForProjectMock.mockResolvedValue(
      audit({ status: "failed", config: undefined }),
    );
    await expect(
      AuditService.getComparison("audit-2", "project-1"),
    ).resolves.toMatchObject({ comparable: false, reason: "incomplete" });
  });

  it("returns no-previous when this is the first completed audit", async () => {
    getAuditForProjectMock.mockResolvedValue(audit());
    getPreviousCompletedAuditMock.mockResolvedValue(null);

    await expect(
      AuditService.getComparison("audit-2", "project-1"),
    ).resolves.toMatchObject({ comparable: false, reason: "no-previous" });
  });

  it("does not compare audits that targeted a different site", async () => {
    getAuditForProjectMock.mockResolvedValue(audit());
    getPreviousCompletedAuditMock.mockResolvedValue(
      audit({ startUrl: "https://other-site.com/" }),
    );

    await expect(
      AuditService.getComparison("audit-2", "project-1"),
    ).resolves.toMatchObject({
      comparable: false,
      reason: "different-site",
      sameSite: false,
    });
  });

  it("compares against the previous completed audit for the same site", async () => {
    getAuditForProjectMock.mockResolvedValue(audit());
    getPreviousCompletedAuditMock.mockResolvedValue(PREVIOUS);
    getIssuesForAuditMock
      .mockReturnValueOnce([issue("missing-title", "https://example.com/b")])
      .mockReturnValueOnce([
        issue("missing-title", "https://example.com/a"),
        issue("missing-title", "https://example.com/b"),
      ]);

    const diff = await AuditService.getComparison("audit-2", "project-1");

    expect(diff.comparable).toBe(true);
    expect(diff.sameSite).toBe(true);
    expect(diff.scopeChanged).toBe(false);
    expect(diff.fixed).toHaveLength(1);
    expect(diff.fixed[0].sampleUrls).toEqual(["https://example.com/a"]);
    expect(diff.remaining[0].affected).toBe(1);
    expect(diff.newly).toEqual([]);
    expect(diff.previous?.startedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("scopes the previous-audit lookup to the same project", async () => {
    getAuditForProjectMock.mockResolvedValue(audit());
    getPreviousCompletedAuditMock.mockResolvedValue(null);

    await AuditService.getComparison("audit-2", "project-1");

    expect(getPreviousCompletedAuditMock).toHaveBeenCalledWith(
      "audit-2",
      "project-1",
    );
  });

  it("surfaces a materially different crawl scale as scopeChanged", async () => {
    getAuditForProjectMock.mockResolvedValue(
      audit({
        pagesCrawled: 4000,
        config: '{"maxPages":5000,"lighthouseStrategy":"none"}',
      }),
    );
    getPreviousCompletedAuditMock.mockResolvedValue(PREVIOUS);

    const diff = await AuditService.getComparison("audit-2", "project-1");
    expect(diff.comparable).toBe(true);
    expect(diff.scopeChanged).toBe(true);
    expect(diff.scopeNote).toContain("page limits");
  });
});
