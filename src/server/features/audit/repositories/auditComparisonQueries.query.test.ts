import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as ComparisonQueriesModule from "./auditComparisonQueries";

// Real in-memory SQLite so the previous-audit selection runs against actual
// SQL: ordering by startedAt, project scoping, and same-site identity skipping
// are exactly the parts mocked service tests cannot see.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let getPreviousCompletedAuditForProject: typeof ComparisonQueriesModule.getPreviousCompletedAuditForProject;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  // The schema option registers the Query API (db.query.<table>) the
  // repository uses, exactly like the production D1 client (db/d1/client.ts).
  const testDb = drizzle(client, { schema });
  vi.doMock("@/db", () => ({ db: testDb }));

  // Mirrors the current audits DDL (src/db/audit.schema.ts); a projects stub
  // satisfies the foreign key.
  await client.executeMultiple(`
    CREATE TABLE projects (id text PRIMARY KEY);
    CREATE TABLE audits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      started_by_user_id TEXT NOT NULL,
      start_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      workflow_instance_id TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      pages_crawled INTEGER NOT NULL DEFAULT 0,
      pages_total INTEGER NOT NULL DEFAULT 0,
      lighthouse_total INTEGER NOT NULL DEFAULT 0,
      lighthouse_completed INTEGER NOT NULL DEFAULT 0,
      lighthouse_failed INTEGER NOT NULL DEFAULT 0,
      current_phase TEXT DEFAULT 'discovery',
      error_code TEXT,
      error_detail TEXT,
      failed_phase TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE INDEX audits_project_id_idx ON audits(project_id);
  `);

  ({ getPreviousCompletedAuditForProject } =
    await import("./auditComparisonQueries"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM audits;
    DELETE FROM projects;
  `);
});

async function seedAudit(input: {
  id: string;
  projectId: string;
  startUrl: string;
  startedAt: string;
  status?: "running" | "completed" | "failed";
}) {
  await client.execute({
    sql: `INSERT INTO audits
      (id, project_id, started_by_user_id, start_url, status, workflow_instance_id, config, started_at)
      VALUES (?, ?, 'user_1', ?, ?, 'wf_x', '{"maxPages":50,"lighthouseStrategy":"none"}', ?)`,
    args: [
      input.id,
      input.projectId,
      input.startUrl,
      input.status ?? "completed",
      input.startedAt,
    ],
  });
}

describe("getPreviousCompletedAuditForProject", () => {
  it("selects the most recent completed audit for the same site", async () => {
    await client.execute({
      sql: "INSERT INTO projects (id) VALUES ('proj_1')",
      args: [],
    });
    await seedAudit({
      id: "audit-0",
      projectId: "proj_1",
      startUrl: "https://other.com/",
      startedAt: "2026-07-01T00:00:00.000Z",
    });
    await seedAudit({
      id: "audit-1",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await seedAudit({
      id: "audit-2",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(
      (await getPreviousCompletedAuditForProject("audit-2", "proj_1"))?.id,
    ).toBe("audit-1");
  });

  it("does not stop at an intervening audit of another site", async () => {
    await client.execute({
      sql: "INSERT INTO projects (id) VALUES ('proj_1')",
      args: [],
    });
    await seedAudit({
      id: "audit-1",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await seedAudit({
      id: "audit-other",
      projectId: "proj_1",
      startUrl: "https://other.com/",
      startedAt: "2026-08-20T00:00:00.000Z",
    });
    await seedAudit({
      id: "audit-2",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    const previous = await getPreviousCompletedAuditForProject(
      "audit-2",
      "proj_1",
    );
    expect(previous?.id).toBe("audit-1");
    // Not the other.com audit that ran in between.
    expect(previous?.id).not.toBe("audit-other");
  });

  it("treats www/non-www and http/https start URLs as the same site identity", async () => {
    await client.execute({
      sql: "INSERT INTO projects (id) VALUES ('proj_1')",
      args: [],
    });
    await seedAudit({
      id: "audit-1",
      projectId: "proj_1",
      startUrl: "http://www.example.com/",
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await seedAudit({
      id: "audit-2",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(
      (await getPreviousCompletedAuditForProject("audit-2", "proj_1"))?.id,
    ).toBe("audit-1");
  });

  it("never crosses project boundaries even for the same site", async () => {
    await client.executeMultiple(`
      INSERT INTO projects (id) VALUES ('proj_1'), ('proj_2');
    `);
    await seedAudit({
      id: "audit-other-project",
      projectId: "proj_2",
      startUrl: "https://example.com/",
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await seedAudit({
      id: "audit-2",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    // proj_1 has an audit but no prior same-project completed audit: the
    // proj_2 audit must never surface as the baseline.
    expect(
      await getPreviousCompletedAuditForProject("audit-2", "proj_1"),
    ).toBeNull();
  });

  it("only considers completed audits as candidates", async () => {
    await client.execute({
      sql: "INSERT INTO projects (id) VALUES ('proj_1')",
      args: [],
    });
    await seedAudit({
      id: "audit-running",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-08-01T00:00:00.000Z",
      status: "running",
    });
    await seedAudit({
      id: "audit-failed",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-08-05T00:00:00.000Z",
      status: "failed",
    });
    await seedAudit({
      id: "audit-2",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(
      await getPreviousCompletedAuditForProject("audit-2", "proj_1"),
    ).toBeNull();
  });

  it("returns null when the current audit is not in the project", async () => {
    await client.execute({
      sql: "INSERT INTO projects (id) VALUES ('proj_1')",
      args: [],
    });
    await seedAudit({
      id: "audit-1",
      projectId: "proj_1",
      startUrl: "https://example.com/",
      startedAt: "2026-08-01T00:00:00.000Z",
    });

    expect(
      await getPreviousCompletedAuditForProject("audit-unknown", "proj_1"),
    ).toBeNull();
  });
});
