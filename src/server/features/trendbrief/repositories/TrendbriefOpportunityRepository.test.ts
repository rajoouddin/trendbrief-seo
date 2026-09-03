import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOpportunityRepository } from "./TrendbriefOpportunityRepository";

type OpportunityUpdateSet = {
  status: string;
  priorityScore: number;
};

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  updateSetArgs: undefined as OpportunityUpdateSet | undefined,
  whereArgs: undefined as SQL | undefined,
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: { select: mocks.select, insert: mocks.insert, update: mocks.update },
}));

function selectReturning(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockImplementation((condition: SQL) => {
    mocks.whereArgs = condition;
    return builder;
  });
  return builder;
}

// Renders a captured Drizzle `where(...)` condition to its raw SQL text and
// bound params, the same technique Ga4ConnectionRepository.test.ts uses to
// introspect a Drizzle SQL fragment (there, to evaluate it; here, just to
// read which columns/values it references).
function renderWhereCondition(condition: SQL): {
  sql: string;
  params: unknown[];
} {
  const query = new SQLiteSyncDialect().sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
}

describe("TrendbriefOpportunityRepository.upsertFromDetection", () => {
  const detectionInput = {
    organizationId: "org_1",
    projectId: "project_1",
    detectorId: "gsc-striking-distance",
    detectorVersion: "v1",
    type: "improve_existing_page" as const,
    subjectUrl: "/page",
    subjectQuery: "query",
    impactScore: 0.6,
    effortScore: 0.2,
    confidenceScore: 0.8,
    priorityScore: 67,
    rationaleCodes: ["striking_distance"],
    relevanceStatus: "confirmed" as const,
    expiresAt: "2026-10-01T00:00:00.000Z",
    dedupeKey: "dedupe_1",
  };

  beforeEach(() => {
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.update.mockReset();
    mocks.updateSetArgs = undefined;
  });

  it("inserts a new row with status 'detected' when no existing opportunity matches the dedupeKey", async () => {
    mocks.select.mockReturnValue(selectReturning([]));
    const insertBuilder = {
      values: vi.fn(),
      returning: vi
        .fn()
        .mockResolvedValue([{ id: "opp_1", status: "detected" }]),
    };
    insertBuilder.values.mockReturnValue(insertBuilder);
    mocks.insert.mockReturnValue(insertBuilder);

    const { opportunity, wasNew } =
      await TrendbriefOpportunityRepository.upsertFromDetection(detectionInput);

    expect(wasNew).toBe(true);
    expect(opportunity.id).toBe("opp_1");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates scores/lastDetectedAt but preserves a non-'detected' status on re-detection", async () => {
    mocks.select.mockReturnValue(
      selectReturning([
        { id: "opp_1", status: "accepted", dedupeKey: "dedupe_1" },
      ]),
    );
    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi
        .fn()
        .mockResolvedValue([{ id: "opp_1", status: "accepted" }]),
    };
    updateBuilder.set.mockImplementation((values: OpportunityUpdateSet) => {
      mocks.updateSetArgs = values;
      return updateBuilder;
    });
    updateBuilder.where.mockReturnValue(updateBuilder);
    mocks.update.mockReturnValue(updateBuilder);

    const { opportunity, wasNew } =
      await TrendbriefOpportunityRepository.upsertFromDetection(detectionInput);

    expect(wasNew).toBe(false);
    expect(opportunity.status).toBe("accepted");
    const setArgs = mocks.updateSetArgs!;
    expect(setArgs.status).toBe("accepted");
    expect(setArgs.priorityScore).toBe(67);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("TrendbriefOpportunityRepository.getForProject", () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.whereArgs = undefined;
  });

  it("filters by both opportunityId and projectId so a foreign project's id returns null", async () => {
    mocks.select.mockReturnValue(selectReturning([]));
    const result = await TrendbriefOpportunityRepository.getForProject(
      "project_1",
      "opp_from_other_org",
    );
    expect(result).toBeNull();
  });

  // The test above passes even if production's `where` clause never checked
  // projectId at all — an empty `select()` result always yields null,
  // regardless of what filtered it. This test instead inspects the actual
  // `where(...)` condition the repository builds and proves it references
  // BOTH columns (and both supplied values), so deleting the projectId `eq`
  // clause from production would make this fail even though the test above
  // would keep passing.
  it("builds a where clause that filters on both trendbrief_opportunities.id and .project_id", async () => {
    mocks.select.mockReturnValue(selectReturning([]));

    await TrendbriefOpportunityRepository.getForProject(
      "project_1",
      "opp_from_other_org",
    );

    expect(mocks.whereArgs).toBeDefined();
    const { sql, params } = renderWhereCondition(mocks.whereArgs!);
    expect(sql).toContain('"trendbrief_opportunities"."id"');
    expect(sql).toContain('"trendbrief_opportunities"."project_id"');
    expect(params).toContain("opp_from_other_org");
    expect(params).toContain("project_1");
  });
});
