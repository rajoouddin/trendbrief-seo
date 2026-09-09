import { describe, expect, it } from "vitest";
import {
  buildRerunDiff,
  buildRerunDiffUnavailable,
  compareAuditScope,
  diffFindings,
} from "@/shared/audit-health/compare";
import type { HealthIssueRow } from "@/shared/audit-health/types";

function issue(issueType: string, pageUrl: string): HealthIssueRow {
  return {
    id: `${issueType}:${pageUrl}`,
    pageId: pageUrl,
    pageUrl,
    issueType,
    severity: "warning",
    detailsJson: null,
  };
}

describe("diffFindings", () => {
  it("computes fixed, remaining and new from URL-level identities", () => {
    const previous = [
      issue("missing-title", "https://example.com/a"),
      issue("missing-title", "https://example.com/b"),
      issue("heading-order-skip", "https://example.com/c"),
    ];
    const current = [
      issue("missing-title", "https://example.com/b"),
      issue("thin-content", "https://example.com/c"),
      issue("missing-title", "https://example.com/d"),
    ];

    const diff = diffFindings(current, previous);
    expect(diff.fixed).toEqual([
      {
        issueType: "missing-title",
        title: "Missing title tag",
        affected: 1,
        sampleUrls: ["https://example.com/a"],
      },
      {
        issueType: "heading-order-skip",
        title: "Heading levels skip",
        affected: 1,
        sampleUrls: ["https://example.com/c"],
      },
    ]);
    expect(diff.remaining).toEqual([
      {
        issueType: "missing-title",
        title: "Missing title tag",
        affected: 1,
        sampleUrls: ["https://example.com/b"],
      },
    ]);
    expect(diff.newly.map((row) => [row.issueType, row.affected])).toEqual([
      ["thin-content", 1],
      ["missing-title", 1],
    ]);
  });

  it("treats normalized URL variants as the same identity", () => {
    const previous = [issue("missing-title", "https://EXAMPLE.com/a?b=2&a=1")];
    const current = [
      issue("missing-title", "https://example.com/a?a=1&b=2#frag"),
    ];
    const diff = diffFindings(current, previous);
    expect(diff.remaining).toHaveLength(1);
    expect(diff.fixed).toEqual([]);
    expect(diff.newly).toEqual([]);
  });

  it("derives grouped affected counts from URL-level identities", () => {
    const previous = ["/1", "/2", "/3"].map((path) =>
      issue("heading-order-skip", `https://example.com${path}`),
    );
    const current = ["/1", "/2"].map((path) =>
      issue("heading-order-skip", `https://example.com${path}`),
    );
    const diff = diffFindings(current, previous);
    expect(diff.fixed[0].affected).toBe(1);
    expect(diff.remaining[0].affected).toBe(2);
    expect(diff.newly).toEqual([]);
  });
});

describe("compareAuditScope", () => {
  it("flags materially different crawl scope instead of silently diffing", () => {
    const scope = compareAuditScope(
      { pagesCrawled: 50, maxPages: 50 },
      { pagesCrawled: 4000, maxPages: 5000 },
    );
    expect(scope.changed).toBe(true);
    expect(scope.note).toContain("page limits");
  });

  it("flags a much smaller actual crawl", () => {
    const scope = compareAuditScope(
      { pagesCrawled: 50, maxPages: 5000 },
      { pagesCrawled: 5, maxPages: 5000 },
    );
    expect(scope.changed).toBe(true);
    expect(scope.note).toContain("different numbers of pages");
  });

  it("treats comparable sizes as comparable", () => {
    const scope = compareAuditScope(
      { pagesCrawled: 49, maxPages: 50 },
      { pagesCrawled: 50, maxPages: 50 },
    );
    expect(scope.changed).toBe(false);
  });
});

describe("buildRerunDiff", () => {
  it("builds a full rerun diff with scope and site context", () => {
    const diff = buildRerunDiff({
      currentIssues: [issue("missing-title", "https://example.com/a")],
      previousIssues: [],
      currentScope: { pagesCrawled: 100, maxPages: 100 },
      previousScope: { pagesCrawled: 100, maxPages: 100 },
      sameSite: true,
      currentStartedAt: "2026-09-01T00:00:00Z",
      previousStartedAt: "2026-08-01T00:00:00Z",
    });
    expect(diff.comparable).toBe(true);
    expect(diff.sameSite).toBe(true);
    expect(diff.scopeChanged).toBe(false);
    expect(diff.fixed).toEqual([]);
    expect(diff.newly).toHaveLength(1);
    expect(diff.previous?.startedAt).toBe("2026-08-01T00:00:00Z");
  });

  it("builds an explicit unavailable diff", () => {
    const diff = buildRerunDiffUnavailable("no-previous");
    expect(diff.comparable).toBe(false);
    expect(diff.reason).toBe("no-previous");
    expect(diff.fixed).toEqual([]);
  });
});
