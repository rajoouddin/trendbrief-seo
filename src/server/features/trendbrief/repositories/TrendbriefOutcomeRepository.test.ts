import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendbriefOutcomeRepository } from "./TrendbriefOutcomeRepository";

type InsertedOutcomeValues = {
  opportunityId: string;
  organizationId: string;
  projectId: string;
  attributionNote: string;
};

type OutcomeConflictSet = {
  baselineWindowStart?: string;
  baselineWindowEnd?: string;
  comparisonWindowStart?: string;
  comparisonWindowEnd?: string;
};

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertedValues: undefined as InsertedOutcomeValues | undefined,
  conflictSet: undefined as OutcomeConflictSet | undefined,
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: { insert: mocks.insert } }));

describe("TrendbriefOutcomeRepository.record", () => {
  beforeEach(() => {
    mocks.insert.mockReset();
    mocks.insertedValues = undefined;
    mocks.conflictSet = undefined;
    const builder = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: "outcome_1" }]),
    };
    builder.values.mockImplementation((values: InsertedOutcomeValues) => {
      mocks.insertedValues = values;
      return builder;
    });
    builder.onConflictDoUpdate.mockImplementation(
      (input: { set: OutcomeConflictSet }) => {
        mocks.conflictSet = input.set;
        return builder;
      },
    );
    mocks.insert.mockReturnValue(builder);
  });

  // This is the acceptance test for "never asserts causation" that actually
  // exercises the REAL repository code's hardcoded attributionNote string,
  // rather than a test double's copy of it (TrendbriefOutcomeService.test.ts
  // asserts the same property, but only against its own mock's string — it
  // would never notice if this file's real string changed to claim
  // causation). If someone edits the real string below to say "caused" or
  // drops "correlation", this test must fail.
  it("inserts a row whose attributionNote reflects correlation, never causation", async () => {
    await TrendbriefOutcomeRepository.record({
      opportunityId: "opp_1",
      organizationId: "org_1",
      projectId: "project_1",
      baselineWindowStart: "2026-08-01",
      baselineWindowEnd: "2026-08-28",
      comparisonWindowStart: "2026-09-01",
      comparisonWindowEnd: "2026-09-28",
      measuredMetrics: {
        baseline: {
          clicks: 10,
          impressions: 300,
          ctr: 0.033,
          position: 10,
          hasData: true,
        },
        comparison: {
          clicks: 25,
          impressions: 320,
          ctr: 0.078,
          position: 6,
          hasData: true,
        },
      },
      classification: "improved",
      confidenceScore: 0.8,
    });

    const insertedValues = mocks.insertedValues!;
    const note = insertedValues.attributionNote.toLowerCase();
    expect(note).toContain("correlation");
    expect(note).not.toContain("caused");
    expect(note).not.toContain("causes");
    expect(note).not.toContain("causing");
  });

  it("updates all four measurement-window columns on conflict", async () => {
    await TrendbriefOutcomeRepository.record({
      opportunityId: "opp_1",
      organizationId: "org_1",
      projectId: "project_1",
      baselineWindowStart: "2026-07-01",
      baselineWindowEnd: "2026-07-31",
      comparisonWindowStart: "2026-08-01",
      comparisonWindowEnd: "2026-08-31",
      measuredMetrics: {
        baseline: {
          clicks: 10,
          impressions: 200,
          ctr: 0.05,
          position: 8,
          hasData: true,
        },
        comparison: {
          clicks: 12,
          impressions: 220,
          ctr: 0.055,
          position: 7,
          hasData: true,
        },
      },
      classification: "improved",
      confidenceScore: 0.8,
    });

    expect(mocks.conflictSet).toMatchObject({
      baselineWindowStart: "2026-07-01",
      baselineWindowEnd: "2026-07-31",
      comparisonWindowStart: "2026-08-01",
      comparisonWindowEnd: "2026-08-31",
    });
  });
});
