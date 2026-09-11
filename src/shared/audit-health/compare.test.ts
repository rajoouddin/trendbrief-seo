import { describe, expect, it } from "vitest";
import {
  buildRerunDiff,
  buildRerunDiffUnavailable,
  compareAuditScope,
  diffFindings,
  hasMeaningfulRerunState,
  issueIdentityKey,
} from "@/shared/audit-health/compare";
import type {
  HealthIssueRow,
  HealthPageRow,
} from "@/shared/audit-health/types";

function issue(
  issueType: string,
  pageUrl: string,
  details?: Record<string, unknown>,
): HealthIssueRow {
  return {
    id: `${issueType}:${pageUrl}`,
    pageId: pageUrl,
    pageUrl,
    issueType,
    severity: "warning",
    detailsJson: details ? JSON.stringify(details) : null,
  };
}

function evaluatedPage(url: string, statusCode = 200): HealthPageRow {
  return {
    url,
    statusCode,
    title: "Example",
    isIndexable: true,
    inSitemap: true,
    fetchClass: "ok",
  };
}

describe("diffFindings — coverage-aware verification", () => {
  it("marks Fixed only when the URL was recrawled and the issue is absent", () => {
    const previous = [
      issue("missing-title", "https://example.com/a"),
      issue("missing-title", "https://example.com/b"),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [
      evaluatedPage("https://example.com/a"),
      evaluatedPage("https://example.com/b"),
    ];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(2);
    expect(diff.unverified).toEqual([]);
  });

  it("never marks Fixed when the URL was not crawled at all", () => {
    const previous = [issue("missing-title", "https://example.com/a")];
    const diff = diffFindings([], previous, []);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
    expect(diff.unverified[0].sampleUrls).toEqual(["https://example.com/a"]);
  });

  it("classifies missing pages from a truncated rerun as Unverified, not Fixed", () => {
    const previous = [
      issue("thin-content", "https://example.com/recrawled"),
      issue("thin-content", "https://example.com/not-recrawled"),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [evaluatedPage("https://example.com/recrawled")];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].sampleUrls).toEqual(["https://example.com/recrawled"]);
    expect(diff.unverified[0].sampleUrls).toEqual([
      "https://example.com/not-recrawled",
    ]);
  });

  it("yields Unverified for different frontier coverage even at similar page counts", () => {
    const previous = [
      issue("missing-meta-description", "https://example.com/aside"),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [
      evaluatedPage("https://example.com/home"),
      evaluatedPage("https://example.com/about"),
    ];
    // same maxPages, similar pagesCrawled — the scope note would not fire, yet
    // the missed URL must still be Unverified, not Fixed.
    const scope = compareAuditScope(
      { pagesCrawled: 2, maxPages: 50 },
      { pagesCrawled: 2, maxPages: 50 },
    );
    expect(scope.changed).toBe(false);

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("does not count a partially failed (blocked) page as re-evaluated", () => {
    const previous = [
      issue("missing-title", "https://example.com/blocked"),
      issue("missing-title", "https://example.com/fetched"),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [
      evaluatedPage("https://example.com/fetched"),
      {
        url: "https://example.com/blocked",
        statusCode: 403,
        title: null,
        isIndexable: true,
        inSitemap: true,
        fetchClass: "blocked",
      },
    ];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].sampleUrls).toEqual(["https://example.com/fetched"]);
    expect(diff.unverified[0].sampleUrls).toEqual([
      "https://example.com/blocked",
    ]);
  });

  it("does not count a fetch-error page as re-evaluated", () => {
    const previous = [issue("missing-title", "https://example.com/broken")];
    const pages = [
      {
        url: "https://example.com/broken",
        statusCode: 0,
        title: null,
        isIndexable: true,
        inSitemap: true,
        fetchClass: "error",
      },
    ];

    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("requires broken-link targets to be re-evaluated as healthy for Fixed", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/fixed-target",
        targetStatus: 404,
      }),
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/never-recrawled",
        targetStatus: 404,
      }),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [
      evaluatedPage("https://example.com/source"),
      evaluatedPage("https://example.com/fixed-target", 200),
    ];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
    // The target that was never re-crawled cannot be called fixed.
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps a broken-link target that still fails in Unverified, not Fixed", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/still-broken",
        targetStatus: 404,
      }),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [
      evaluatedPage("https://example.com/source"),
      evaluatedPage("https://example.com/still-broken", 404),
    ];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });
});

describe("diffFindings — identity and dedup", () => {
  it("keeps two broken targets from one page as distinct identities", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/gone-a",
        targetStatus: 404,
      }),
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/gone-b",
        targetStatus: 500,
      }),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [
      evaluatedPage("https://example.com/source"),
      evaluatedPage("https://example.com/gone-a", 200),
      evaluatedPage("https://example.com/gone-b", 200),
    ];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(2);
  });

  it("reports one Fixed and one New when one target is fixed and another introduced", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/old",
        targetStatus: 404,
      }),
    ];
    const current = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/new",
        targetStatus: 404,
      }),
    ];
    const pages = [
      evaluatedPage("https://example.com/source"),
      evaluatedPage("https://example.com/old", 200),
      // /new was crawled and failed, so it stays out of the healthy set.
      evaluatedPage("https://example.com/new", 404),
    ];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
    expect(diff.newly[0].affected).toBe(1);
    expect(diff.newly[0].sampleUrls).toEqual(["https://example.com/source"]);
  });

  it("does not inflate counts when identical rows were persisted twice", () => {
    const previous = [
      issue("missing-title", "https://example.com/a"),
      issue("missing-title", "https://example.com/a"),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [evaluatedPage("https://example.com/a")];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
  });

  it("normalizes query-param ordering in the identity", () => {
    const previous = [
      issue("missing-title", "https://example.com/a?b=2&a=1#frag"),
    ];
    const current: HealthIssueRow[] = [];
    const pages = [evaluatedPage("https://example.com/a?a=1&b=2")];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
    expect(diff.unverified).toEqual([]);
  });

  it("treats fragment differences as the same identity", () => {
    const previous = [issue("missing-title", "https://example.com/a#one")];
    const current: HealthIssueRow[] = [];
    const pages = [evaluatedPage("https://example.com/a#two")];

    const diff = diffFindings(current, previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
  });

  it("keeps distinct identities for URL variants that could be different resources", () => {
    expect(
      issueIdentityKey(issue("missing-title", "https://example.com/a")),
    ).not.toEqual(
      issueIdentityKey(issue("missing-title", "https://example.com/a/")),
    );
    expect(
      issueIdentityKey(issue("missing-title", "https://example.com/a")),
    ).not.toEqual(
      issueIdentityKey(issue("missing-title", "http://example.com/a")),
    );
    expect(
      issueIdentityKey(issue("missing-title", "https://example.com/a")),
    ).not.toEqual(
      issueIdentityKey(issue("missing-title", "https://www.example.com/a")),
    );
  });

  it("does not silently equate an http finding with a new https finding", () => {
    const previous = [issue("missing-title", "http://example.com/a")];
    const current = [issue("missing-title", "https://example.com/a")];
    const pages = [evaluatedPage("https://example.com/a")];

    const diff = diffFindings(current, previous, pages);
    // No Fixed: the http URL was never re-crawled (pages are https).
    expect(diff.fixed).toEqual([]);
    // The previous http finding is not positive-resolved -> Unverified.
    expect(diff.unverified[0].affected).toBe(1);
    // The https URL is a distinct, new identity.
    expect(diff.newly[0].affected).toBe(1);
  });

  it("groups similar URL-level identities into affected counts", () => {
    const previous = ["/1", "/2", "/3"].map((path) =>
      issue("heading-order-skip", `https://example.com${path}`),
    );
    const current = ["/1", "/2"].map((path) =>
      issue("heading-order-skip", `https://example.com${path}`),
    );
    const pages = ["/1", "/2"].map((path) =>
      evaluatedPage(`https://example.com${path}`),
    );

    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(2);
    // /3 was not re-crawled: Unverified, not Fixed.
    expect(diff.unverified[0].affected).toBe(1);
    expect(diff.fixed).toEqual([]);
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
      currentPages: [evaluatedPage("https://example.com/a")],
      currentScope: { pagesCrawled: 100, maxPages: 100 },
      previousScope: { pagesCrawled: 100, maxPages: 100 },
      sameSite: true,
      currentStartedAt: "2026-09-01T00:00:00Z",
      previousStartedAt: "2026-08-01T00:00:00Z",
      currentStartUrl: "https://example.com/",
      previousStartUrl: "https://example.com/",
    });
    expect(diff.comparable).toBe(true);
    expect(diff.sameSite).toBe(true);
    expect(diff.scopeChanged).toBe(false);
    expect(diff.originChanged?.changed).toBe(false);
    expect(diff.fixed).toEqual([]);
    expect(diff.newly).toHaveLength(1);
    expect(diff.unverified).toEqual([]);
    expect(diff.previous?.startedAt).toBe("2026-08-01T00:00:00Z");
  });

  it("builds an explicit unavailable diff", () => {
    const diff = buildRerunDiffUnavailable("no-previous");
    expect(diff.comparable).toBe(false);
    expect(diff.reason).toBe("no-previous");
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified).toEqual([]);
  });
});

describe("hasMeaningfulRerunState", () => {
  it("treats a missing comparison as meaningless", () => {
    expect(hasMeaningfulRerunState(undefined)).toBe(false);
  });

  it("treats a comparable comparison as meaningful even with zero totals", () => {
    const diff = buildRerunDiffUnavailable("no-previous");
    expect(
      hasMeaningfulRerunState({
        ...diff,
        comparable: true,
        fixed: [],
        remaining: [],
        newly: [],
        unverified: [],
      }),
    ).toBe(true);
  });

  it("treats an all-error rerun comparison (previous rows unverified) as meaningful", () => {
    const diff = buildRerunDiff({
      currentIssues: [],
      previousIssues: [issue("missing-title", "https://example.com/a")],
      currentPages: [],
      currentScope: { pagesCrawled: 3, maxPages: 50 },
      previousScope: { pagesCrawled: 50, maxPages: 50 },
      sameSite: true,
      currentStartedAt: "2026-09-01T00:00:00Z",
      previousStartedAt: "2026-08-01T00:00:00Z",
      currentStartUrl: "https://example.com/",
      previousStartUrl: "https://example.com/",
    });
    expect(diff.comparable).toBe(true);
    expect(diff.unverified).toHaveLength(1);
    expect(hasMeaningfulRerunState(diff)).toBe(true);
  });

  it("does not treat an ordinary first audit (no previous) as meaningful UI on its own", () => {
    expect(
      hasMeaningfulRerunState(buildRerunDiffUnavailable("no-previous")),
    ).toBe(false);
  });

  it("treats non-comparable states that communicate a condition as meaningful", () => {
    expect(
      hasMeaningfulRerunState(buildRerunDiffUnavailable("different-site")),
    ).toBe(true);
    expect(
      hasMeaningfulRerunState(buildRerunDiffUnavailable("incomplete")),
    ).toBe(true);
  });
});
