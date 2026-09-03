import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefRecommendationRepository } from "./TrendbriefRecommendationRepository";

const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update } }));

function selectReturning(rows: unknown[]) {
  const builder = { from: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue(rows) };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  return builder;
}

const upsertInput = {
  opportunityId: "opp_1",
  organizationId: "org_1",
  projectId: "project_1",
  recommendationType: "improve_existing_page" as const,
  proposedAction: { page: "/page", reasonCodes: ["striking_distance"], suggestedNextAnalysis: ["inspect_ranking_serp"] },
  groundedSummary: "summary text",
};

describe("TrendbriefRecommendationRepository.upsertForOpportunity", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
  });

  it("inserts version 1 with generationMethod 'deterministic' when none exists", async () => {
    mocks.select.mockReturnValue(selectReturning([]));
    const insertBuilder = { values: vi.fn(), returning: vi.fn().mockResolvedValue([{ id: "rec_1", version: 1 }]) };
    insertBuilder.values.mockReturnValue(insertBuilder);
    mocks.insert.mockReturnValue(insertBuilder);

    await TrendbriefRecommendationRepository.upsertForOpportunity(upsertInput);

    const insertedValues = insertBuilder.values.mock.calls[0][0];
    expect(insertedValues.version).toBe(1);
    expect(insertedValues.generationMethod).toBe("deterministic");
    expect(JSON.parse(insertedValues.proposedAction)).toEqual(upsertInput.proposedAction);
  });

  it("bumps the version on regeneration for an existing opportunity", async () => {
    mocks.select.mockReturnValue(selectReturning([{ id: "rec_1", version: 1 }]));
    const updateBuilder = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([{ id: "rec_1", version: 2 }]) };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    mocks.update.mockReturnValue(updateBuilder);

    const result = await TrendbriefRecommendationRepository.upsertForOpportunity(upsertInput);

    expect(result.version).toBe(2);
    expect(updateBuilder.set.mock.calls[0][0].version).toBe(2);
  });
});
