import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefActionRepository } from "./TrendbriefActionRepository";

type ActionUpdateSet = {
  actionType?: string;
  actor?: string;
  acceptedAt?: string | null;
  completedAt?: string | null;
};

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  updateSet: undefined as ActionUpdateSet | undefined,
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: { select: mocks.select, update: mocks.update },
}));

describe("TrendbriefActionRepository.recordAction", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.update.mockReset();
    mocks.updateSet = undefined;
  });

  it("stores the latest actor on accept-to-complete replacement without rewriting acceptedAt", async () => {
    const acceptedAt = "2026-08-10T10:00:00.000Z";
    const existing = {
      id: "action_1",
      opportunityId: "opp_1",
      actionType: "accept",
      status: "accepted",
      actor: "accepting@example.com",
      notes: "Accepted",
      acceptedAt,
      completedAt: null,
    };
    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([existing]),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    selectBuilder.where.mockReturnValue(selectBuilder);
    mocks.select.mockReturnValue(selectBuilder);

    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    updateBuilder.set.mockImplementation((values: ActionUpdateSet) => {
      mocks.updateSet = values;
      return updateBuilder;
    });
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.returning.mockImplementation(async () => [
      { ...existing, ...mocks.updateSet, acceptedAt },
    ]);
    mocks.update.mockReturnValue(updateBuilder);

    const row = await TrendbriefActionRepository.recordAction({
      organizationId: "org_1",
      projectId: "project_1",
      opportunityId: "opp_1",
      actionType: "complete",
      actor: "completing@example.com",
      notes: "Done",
    });

    expect(mocks.updateSet).toMatchObject({
      actionType: "complete",
      actor: "completing@example.com",
    });
    expect(mocks.updateSet).not.toHaveProperty("acceptedAt");
    expect(row.actor).toBe("completing@example.com");
    expect(row.acceptedAt).toBe(acceptedAt);
  });
});
