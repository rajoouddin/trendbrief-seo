import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeEvidenceDedupeKey,
  computeLegacyEvidenceDedupeKey,
} from "../domain/dedupeKeys";
import { TrendbriefEvidenceRepository } from "./TrendbriefEvidenceRepository";

type InsertedEvidenceValues = {
  organizationId: string;
  projectId: string;
  dedupeKey: string;
  metrics: string;
};

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insertedValues: undefined as InsertedEvidenceValues | undefined,
  conflictTarget: undefined as unknown,
  updateSet: undefined as Record<string, unknown> | undefined,
  selectWhere: [] as SQL[],
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: { insert: mocks.insert, select: mocks.select, update: mocks.update },
}));

function selectReturning(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockImplementation((condition: SQL) => {
    mocks.selectWhere.push(condition);
    return builder;
  });
  return builder;
}

function renderWhere(condition: SQL) {
  return new SQLiteSyncDialect().sqlToQuery(condition);
}

describe("TrendbriefEvidenceRepository.upsert", () => {
  beforeEach(() => {
    mocks.insert.mockReset();
    mocks.select.mockReset();
    mocks.update.mockReset();
    mocks.insertedValues = undefined;
    mocks.conflictTarget = undefined;
    mocks.updateSet = undefined;
    mocks.selectWhere = [];
    mocks.select.mockReturnValue(selectReturning([]));
    const builder = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      returning: vi
        .fn()
        .mockResolvedValue([{ id: "evidence_1", dedupeKey: "key_1" }]),
    };
    builder.values.mockImplementation((values: InsertedEvidenceValues) => {
      mocks.insertedValues = values;
      return builder;
    });
    builder.onConflictDoUpdate.mockImplementation(
      (input: { target: unknown }) => {
        mocks.conflictTarget = input.target;
        return builder;
      },
    );
    mocks.insert.mockReturnValue(builder);
  });

  it("inserts with the caller-supplied organizationId/projectId and an onConflict target on dedupeKey", async () => {
    const row = await TrendbriefEvidenceRepository.upsert({
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc",
      evidenceType: "gsc_page_query_performance",
      subjectUrl: "/page",
      subjectQuery: "query",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
      dataState: "final",
      metrics: { clicks: 10, impressions: 200, ctr: 0.05, position: 8 },
      dedupeKey: "key_1",
    });

    expect(row.id).toBe("evidence_1");
    const insertedValues = mocks.insertedValues!;
    expect(insertedValues.organizationId).toBe("org_1");
    expect(insertedValues.projectId).toBe("project_1");
    expect(insertedValues.dedupeKey).toBe("key_1");
    expect(JSON.parse(insertedValues.metrics)).toEqual({
      clicks: 10,
      impressions: 200,
      ctr: 0.05,
      position: 8,
    });
    expect(mocks.conflictTarget).toBeDefined();
  });

  it("lazily rekeys a fully matching legacy row instead of inserting a duplicate", async () => {
    const identity = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/page",
      subjectQuery: "query",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };
    const dedupeKey = computeEvidenceDedupeKey(identity);
    mocks.select.mockReturnValue(
      selectReturning([
        {
          id: "evidence_legacy",
          ...identity,
          dedupeKey: computeLegacyEvidenceDedupeKey(identity),
        },
      ]),
    );
    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi
        .fn()
        .mockResolvedValue([{ id: "evidence_legacy", ...identity, dedupeKey }]),
    };
    updateBuilder.set.mockImplementation((values: Record<string, unknown>) => {
      mocks.updateSet = values;
      return updateBuilder;
    });
    updateBuilder.where.mockReturnValue(updateBuilder);
    mocks.update.mockReturnValue(updateBuilder);

    const row = await TrendbriefEvidenceRepository.upsert({
      ...identity,
      dataState: "final",
      metrics: { clicks: 10, impressions: 200, ctr: 0.05, position: 8 },
      dedupeKey,
    });

    expect(row.id).toBe("evidence_legacy");
    expect(mocks.updateSet).toMatchObject({ dedupeKey });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not match a legacy collision unless tenant, project, and every identity component match", async () => {
    const identity = {
      organizationId: "org_safe",
      projectId: "project_safe",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/page::part",
      subjectQuery: "query",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };
    mocks.select.mockReturnValue(selectReturning([]));

    await TrendbriefEvidenceRepository.upsert({
      ...identity,
      dataState: "final",
      metrics: { clicks: 1, impressions: 20, ctr: 0.05, position: 8 },
      dedupeKey: computeEvidenceDedupeKey(identity),
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledOnce();
    const query = renderWhere(mocks.selectWhere.at(-1)!);
    expect(query.sql).toContain('"organization_id"');
    expect(query.sql).toContain('"project_id"');
    expect(query.sql).toContain('"source"');
    expect(query.sql).toContain('"evidence_type"');
    expect(query.sql).toContain('"subject_url"');
    expect(query.sql).toContain('"subject_query"');
    expect(query.sql).toContain('"observation_start"');
    expect(query.sql).toContain('"observation_end"');
    expect(query.params).toEqual(
      expect.arrayContaining([
        "org_safe",
        "project_safe",
        "/page::part",
        "query",
        computeLegacyEvidenceDedupeKey(identity),
      ]),
    );
  });
});

describe("TrendbriefEvidenceRepository.listByIds", () => {
  it("returns an empty array without querying when given no ids", async () => {
    mocks.select.mockReset();
    const rows = await TrendbriefEvidenceRepository.listByIds([]);
    expect(rows).toEqual([]);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
