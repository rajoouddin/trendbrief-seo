import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefEvidenceRepository } from "./TrendbriefEvidenceRepository";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { insert: mocks.insert, select: mocks.select } }));

describe("TrendbriefEvidenceRepository.upsert", () => {
  beforeEach(() => {
    mocks.insert.mockReset();
    const builder = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: "evidence_1", dedupeKey: "key_1" }]),
    };
    builder.values.mockReturnValue(builder);
    builder.onConflictDoUpdate.mockReturnValue(builder);
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
    const insertedValues = mocks.insert.mock.results[0]!.value.values.mock.calls[0][0];
    expect(insertedValues.organizationId).toBe("org_1");
    expect(insertedValues.projectId).toBe("project_1");
    expect(insertedValues.dedupeKey).toBe("key_1");
    expect(JSON.parse(insertedValues.metrics)).toEqual({
      clicks: 10,
      impressions: 200,
      ctr: 0.05,
      position: 8,
    });
    const conflictArgs = mocks.insert.mock.results[0]!.value.onConflictDoUpdate.mock.calls[0][0];
    expect(conflictArgs.target).toBeDefined();
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
