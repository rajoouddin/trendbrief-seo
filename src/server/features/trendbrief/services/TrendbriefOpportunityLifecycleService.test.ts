import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOpportunityLifecycleService } from "./TrendbriefOpportunityLifecycleService";

const mocks = vi.hoisted(() => ({
  getForProject: vi.fn(),
  updateStatus: vi.fn(),
  recordAction: vi.fn(),
}));

vi.mock("../repositories/TrendbriefOpportunityRepository", () => ({
  TrendbriefOpportunityRepository: { getForProject: mocks.getForProject, updateStatus: mocks.updateStatus },
}));
vi.mock("../repositories/TrendbriefActionRepository", () => ({
  TrendbriefActionRepository: { recordAction: mocks.recordAction },
}));

describe("TrendbriefOpportunityLifecycleService", () => {
  beforeEach(() => {
    mocks.getForProject.mockReset();
    mocks.updateStatus.mockReset();
    mocks.recordAction.mockReset();
    mocks.recordAction.mockResolvedValue({ id: "action_1" });
  });

  it("accepts a 'detected' opportunity and records an accept action", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "detected" });
    mocks.updateStatus.mockResolvedValue({ id: "opp_1", status: "accepted" });

    const result = await TrendbriefOpportunityLifecycleService.acceptOpportunity({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actor: "user_1",
    });

    expect(result.status).toBe("accepted");
    expect(mocks.updateStatus).toHaveBeenCalledWith("opp_1", "project_1", "accepted");
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "accept", actor: "user_1", opportunityId: "opp_1" }),
    );
  });

  it("rejects a 'detected' opportunity", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "detected" });
    mocks.updateStatus.mockResolvedValue({ id: "opp_1", status: "rejected" });

    const result = await TrendbriefOpportunityLifecycleService.rejectOpportunity({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actor: "user_1",
    });

    expect(result.status).toBe("rejected");
  });

  it("completes an 'accepted' opportunity", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "accepted" });
    mocks.updateStatus.mockResolvedValue({ id: "opp_1", status: "completed" });

    const result = await TrendbriefOpportunityLifecycleService.completeOpportunity({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actor: "user_1",
    });

    expect(result.status).toBe("completed");
  });

  it("rejects completing a 'detected' opportunity (invalid transition — must be accepted first)", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "detected" });

    await expect(
      TrendbriefOpportunityLifecycleService.completeOpportunity({
        organizationId: "org_1",
        projectId: "project_1",
        opportunityId: "opp_1",
        actor: "user_1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects accepting an already-rejected opportunity (terminal state)", async () => {
    mocks.getForProject.mockResolvedValue({ id: "opp_1", projectId: "project_1", status: "rejected" });

    await expect(
      TrendbriefOpportunityLifecycleService.acceptOpportunity({
        organizationId: "org_1",
        projectId: "project_1",
        opportunityId: "opp_1",
        actor: "user_1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws NOT_FOUND for an opportunity that doesn't belong to the given project", async () => {
    mocks.getForProject.mockResolvedValue(null);

    await expect(
      TrendbriefOpportunityLifecycleService.acceptOpportunity({
        organizationId: "org_1",
        projectId: "project_1",
        opportunityId: "opp_from_other_org",
        actor: "user_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
