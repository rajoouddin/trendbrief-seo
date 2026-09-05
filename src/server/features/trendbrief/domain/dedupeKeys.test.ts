import { describe, expect, it } from "vitest";
import {
  computeEvidenceDedupeKey,
  computeLegacyEvidenceDedupeKey,
  computeLegacyOpportunityDedupeKey,
  computeOpportunityDedupeKey,
} from "./dedupeKeys";

describe("computeEvidenceDedupeKey", () => {
  it("is stable for identical inputs", () => {
    const input = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };
    expect(computeEvidenceDedupeKey(input)).toBe(
      computeEvidenceDedupeKey(input),
    );
  });

  it("differs when the observation window differs (a new window is new evidence)", () => {
    const base = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
    };
    const a = computeEvidenceDedupeKey({
      ...base,
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    });
    const b = computeEvidenceDedupeKey({
      ...base,
      observationStart: "2026-08-02",
      observationEnd: "2026-08-29",
    });
    expect(a).not.toBe(b);
  });

  it("collapses a null subjectQuery onto the empty string, so both dedupe identically", () => {
    const base = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      subjectUrl: "/page",
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };
    const withNull = computeEvidenceDedupeKey({ ...base, subjectQuery: null });
    const withEmpty = computeEvidenceDedupeKey({ ...base, subjectQuery: "" });
    expect(withNull).toBe(withEmpty);
  });

  it("does not collide when components contain the legacy :: delimiter", () => {
    const shared = {
      organizationId: "org_1",
      projectId: "project_1",
      source: "gsc" as const,
      evidenceType: "gsc_page_query_performance" as const,
      observationStart: "2026-08-01",
      observationEnd: "2026-08-28",
    };

    const first = computeEvidenceDedupeKey({
      ...shared,
      subjectUrl: "/page::part",
      subjectQuery: "query",
    });
    const second = computeEvidenceDedupeKey({
      ...shared,
      subjectUrl: "/page",
      subjectQuery: "part::query",
    });

    expect(first).not.toBe(second);
    expect(first).toMatch(/^v2:/);
    expect(
      computeLegacyEvidenceDedupeKey({
        ...shared,
        subjectUrl: "/page::part",
        subjectQuery: "query",
      }),
    ).toBe(
      computeLegacyEvidenceDedupeKey({
        ...shared,
        subjectUrl: "/page",
        subjectQuery: "part::query",
      }),
    );
  });
});

describe("computeOpportunityDedupeKey", () => {
  it("is stable across re-detection regardless of observation window", () => {
    const input = {
      organizationId: "org_1",
      projectId: "project_1",
      detectorKey: "gsc-striking-distance:v1",
      subjectUrl: "/tree-removal-cheltenham",
      subjectQuery: "tree removal cheltenham",
    };
    expect(computeOpportunityDedupeKey(input)).toBe(
      computeOpportunityDedupeKey(input),
    );
  });

  it("differs for a different detector version (old opportunities aren't silently merged into a new detector's identity)", () => {
    const base = {
      organizationId: "org_1",
      projectId: "project_1",
      subjectUrl: "/page",
      subjectQuery: "query",
    };
    const v1 = computeOpportunityDedupeKey({
      ...base,
      detectorKey: "gsc-striking-distance:v1",
    });
    const v2 = computeOpportunityDedupeKey({
      ...base,
      detectorKey: "gsc-striking-distance:v2",
    });
    expect(v1).not.toBe(v2);
  });

  it("does not collide when components contain the legacy :: delimiter", () => {
    const shared = {
      organizationId: "org_1",
      projectId: "project_1",
      subjectQuery: "query",
    };
    const first = computeOpportunityDedupeKey({
      ...shared,
      detectorKey: "detector::v1",
      subjectUrl: "/page",
    });
    const second = computeOpportunityDedupeKey({
      ...shared,
      detectorKey: "detector",
      subjectUrl: "v1::/page",
    });

    expect(first).not.toBe(second);
    expect(first).toMatch(/^v2:/);
    expect(
      computeLegacyOpportunityDedupeKey({
        ...shared,
        detectorKey: "detector::v1",
        subjectUrl: "/page",
      }),
    ).toBe(
      computeLegacyOpportunityDedupeKey({
        ...shared,
        detectorKey: "detector",
        subjectUrl: "v1::/page",
      }),
    );
  });
});
