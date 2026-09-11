import { describe, expect, it } from "vitest";
import {
  buildFindings,
  buildPassedChecks,
  FIX_FIRST_PRIORITY,
  fixTheseFirst,
  NEVER_FIX_FIRST,
  normalizeAffectedUrl,
  otherFindings,
} from "@/shared/audit-health";
import type {
  Finding,
  HealthIssueRow,
  HealthPageRow,
} from "@/shared/audit-health";

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

function page(overrides: Partial<HealthPageRow>): HealthPageRow {
  return {
    url: "https://example.com/",
    statusCode: 200,
    title: "Example",
    isIndexable: true,
    inSitemap: true,
    wordCount: 500,
    internalLinkCount: 1,
    fetchClass: "ok",
    ...overrides,
  };
}

function types(findings: Finding[]): string[] {
  return findings.map((finding) => finding.issueType);
}

describe("buildFindings — prioritisation", () => {
  it("orders the P0 classes deterministically in Fix these first", () => {
    const issues = [
      issue("missing-h1", "https://example.com/noh1"),
      issue("missing-title", "https://example.com/notitle"),
      issue("canonical-conflict", "https://example.com/canon"),
      issue("broken-internal-link", "https://example.com/links"),
      issue("server-error", "https://example.com/500"),
      issue("blocked-page", "https://example.com/blocked"),
      issue("sitemap-noindex-conflict", "https://example.com/conflict"),
      issue("thin-content", "https://example.com/thin"),
      issue("heading-order-skip", "https://example.com/headings"),
      issue("title-too-long", "https://example.com/long"),
    ];
    const pages = [
      page({ url: "https://example.com/noh1", wordCount: 400 }),
      page({ url: "https://example.com/notitle" }),
      page({ url: "https://example.com/canon" }),
      page({ url: "https://example.com/links" }),
      page({ url: "https://example.com/500", statusCode: 500 }),
      page({ url: "https://example.com/blocked", statusCode: 403 }),
      page({ url: "https://example.com/conflict", isIndexable: false }),
      page({ url: "https://example.com/thin", wordCount: 30 }),
      page({ url: "https://example.com/headings" }),
      page({ url: "https://example.com/long", title: "x".repeat(70) }),
    ];

    const findings = buildFindings(issues, pages);
    expect(types(fixTheseFirst(findings))).toEqual([
      "blocked-page",
      "server-error",
      "broken-internal-link",
      "sitemap-noindex-conflict",
      "canonical-conflict",
      "missing-title",
      "missing-h1",
    ]);
    // Their priority slots match the declared order, so relative order can't
    // silently drift from the product's P0 list.
    expect(fixTheseFirst(findings).map((f) => f.priority)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("explicitly excludes low-value checks from Fix these first", () => {
    const overlap = NEVER_FIX_FIRST.filter((type) =>
      FIX_FIRST_PRIORITY.includes(type),
    );
    expect(overlap).toEqual([]);
  });

  it("sends excluded checks to the secondary bands, not the primary list", () => {
    const findings = buildFindings(
      [
        issue("thin-content", "https://example.com/thin"),
        issue("title-too-long", "https://example.com/long"),
        issue("title-too-short", "https://example.com/short"),
        issue("meta-description-too-long", "https://example.com/md-long"),
        issue("meta-description-too-short", "https://example.com/md-short"),
        issue("heading-order-skip", "https://example.com/headings"),
        issue("noindex-page", "https://example.com/noindex"),
      ],
      [
        page({ url: "https://example.com/thin", wordCount: 20 }),
        page({ url: "https://example.com/long", title: "x".repeat(70) }),
        page({ url: "https://example.com/short", title: "Tiny" }),
        page({
          url: "https://example.com/md-long",
          metaDescription: "x".repeat(200),
        }),
        page({
          url: "https://example.com/md-short",
          metaDescription: "x".repeat(50),
        }),
        page({ url: "https://example.com/headings" }),
        page({ url: "https://example.com/noindex", isIndexable: false }),
      ],
    );

    expect(types(fixTheseFirst(findings))).toEqual([]);
    const others = otherFindings(findings);
    expect(types(others)).toEqual([
      "thin-content",
      "title-too-long",
      "title-too-short",
      "meta-description-too-long",
      "meta-description-too-short",
      "heading-order-skip",
      "noindex-page",
    ]);
    expect(others.find((f) => f.issueType === "thin-content")?.band).toBe(
      "opportunity",
    );
    expect(others.find((f) => f.issueType === "heading-order-skip")?.band).toBe(
      "informational",
    );
    expect(others.find((f) => f.issueType === "noindex-page")?.band).toBe(
      "informational",
    );
  });

  it("drops a P0 finding when none of its URLs is actually indexable", () => {
    const findings = buildFindings(
      [
        issue("missing-title", "https://example.com/noindex-a"),
        issue("missing-title", "https://example.com/noindex-b"),
      ],
      [
        page({ url: "https://example.com/noindex-a", isIndexable: false }),
        page({ url: "https://example.com/noindex-b", isIndexable: false }),
      ],
    );
    expect(types(fixTheseFirst(findings))).toEqual([]);
  });

  it("keeps title/h1 findings only for indexable, content-bearing pages", () => {
    const findings = buildFindings(
      [
        issue("missing-title", "https://example.com/indexable"),
        issue("missing-title", "https://example.com/noindex"),
        issue("missing-h1", "https://example.com/with-content"),
        issue("missing-h1", "https://example.com/empty"),
      ],
      [
        page({ url: "https://example.com/indexable" }),
        page({ url: "https://example.com/noindex", isIndexable: false }),
        page({ url: "https://example.com/with-content", wordCount: 300 }),
        page({ url: "https://example.com/empty", wordCount: 0 }),
      ],
    );

    const primary = fixTheseFirst(findings);
    const title = primary.find((f) => f.issueType === "missing-title")!;
    expect(title.affectedCount).toBe(1);
    expect(title.affected[0].url).toBe("https://example.com/indexable");
    const h1 = primary.find((f) => f.issueType === "missing-h1")!;
    expect(h1.affectedCount).toBe(1);
    expect(h1.affected[0].url).toBe("https://example.com/with-content");
  });
});

describe("buildFindings — grouping", () => {
  it("groups many URLs of the same type into one finding with a count", () => {
    const findings = buildFindings(
      ["/a", "/b", "/c"].map((path) =>
        issue("heading-order-skip", `https://example.com${path}`),
      ),
      ["/a", "/b", "/c"].map((path) =>
        page({ url: `https://example.com${path}` }),
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe("heading-order-skip");
    expect(findings[0].affectedCount).toBe(3);
    expect(findings[0].affected).toHaveLength(3);
  });

  it("dedupes URLs that normalize to the same identity", () => {
    const findings = buildFindings(
      [
        issue("title-too-long", "https://example.com/p?b=2&a=1"),
        issue("title-too-long", "https://example.com/p?a=1&b=2#frag"),
      ],
      [page({ url: "https://example.com/p?b=2&a=1", title: "x".repeat(70) })],
    );
    expect(findings[0].affectedCount).toBe(1);
  });

  it("keeps one row per distinct broken-link target as one grouped finding", () => {
    const findings = buildFindings(
      [
        issue("broken-internal-link", "https://example.com/source", {
          targetUrl: "https://example.com/gone-a",
          targetStatus: 404,
        }),
        issue("broken-internal-link", "https://example.com/source", {
          targetUrl: "https://example.com/gone-b",
          targetStatus: 500,
        }),
      ],
      [page({ url: "https://example.com/source" })],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].affectedCount).toBe(1);
  });
});

describe("buildFindings — evidence", () => {
  it("renders status evidence from the page row", () => {
    const [finding] = buildFindings(
      [issue("server-error", "https://example.com/500")],
      [page({ url: "https://example.com/500", statusCode: 500 })],
    );
    expect(finding.affected[0].evidence).toEqual([
      { label: "HTTP status", value: "500" },
    ]);
  });

  it("renders broken-link evidence from the issue details", () => {
    const [finding] = buildFindings(
      [
        issue("broken-internal-link", "https://example.com/source", {
          targetUrl: "https://example.com/gone",
          targetStatus: 404,
        }),
      ],
      [page({ url: "https://example.com/source" })],
    );
    expect(finding.affected[0].evidence).toEqual([
      { label: "Link target", value: "https://example.com/gone" },
      { label: "Target status", value: "404" },
    ]);
  });

  it("renders sitemap/noindex conflict evidence", () => {
    const [finding] = buildFindings(
      [
        issue("sitemap-noindex-conflict", "https://example.com/conflict", {
          robotsMeta: "noindex",
        }),
      ],
      [
        page({
          url: "https://example.com/conflict",
          isIndexable: false,
          inSitemap: true,
        }),
      ],
    );
    expect(finding.affected[0].evidence).toEqual([
      { label: "Sitemap", value: "listed" },
      { label: "Noindex signal", value: "noindex" },
    ]);
  });

  it("renders title-length evidence from the page and details", () => {
    const [finding] = buildFindings(
      [issue("title-too-long", "https://example.com/long", { length: 70 })],
      [page({ url: "https://example.com/long", title: "x".repeat(70) })],
    );
    expect(finding.affected[0].evidence).toEqual([
      { label: "Current title", value: "x".repeat(70) },
      { label: "Length", value: "70 characters" },
    ]);
  });

  it("never dumps raw JSON detail keys as evidence", () => {
    const [finding] = buildFindings(
      [
        issue("heading-order-skip", "https://example.com/headings", {
          unexpectedInternalKey: "secret-internal-value",
        }),
      ],
      [page({ url: "https://example.com/headings" })],
    );
    expect(finding.affected[0].evidence).toEqual([]);
  });

  it("provides problem/what-to-do/how-to-verify copy per finding", () => {
    const [finding] = buildFindings(
      [issue("server-error", "https://example.com/500")],
      [page({ url: "https://example.com/500", statusCode: 500 })],
    );
    expect(finding.problem).toContain("5xx");
    expect(finding.whyItMatters.length).toBeGreaterThan(0);
    expect(finding.whatToDo.length).toBeGreaterThan(0);
    expect(finding.howToVerify).toContain("successful response");
  });
});

describe("buildPassedChecks", () => {
  it("claims nothing without crawled pages", () => {
    expect(buildPassedChecks([], [])).toEqual([]);
  });

  it("claims supported checks when there is evidence for none of the failures", () => {
    const checks = buildPassedChecks(
      [issue("title-too-long", "https://example.com/long")],
      [page({}), page({})],
    );
    expect(checks.map((c) => c.id)).toEqual([
      "no-broken-links",
      "no-server-errors",
      "canonical-consistent",
      "sitemap-found",
    ]);
  });

  it("withholds a passed check when that failure type exists", () => {
    const checks = buildPassedChecks(
      [
        issue("broken-internal-link", "https://example.com/source"),
        issue("server-error", "https://example.com/500"),
      ],
      [page({}), page({ statusCode: 500 })],
    );
    expect(checks.map((c) => c.id)).toEqual([
      "canonical-consistent",
      "sitemap-found",
    ]);
  });

  it("withholds the sitemap check when the audit saw no sitemap", () => {
    const checks = buildPassedChecks([], [page({ inSitemap: false })]);
    expect(checks.map((c) => c.id)).toEqual([
      "no-broken-links",
      "no-server-errors",
      "canonical-consistent",
    ]);
  });

  it("withholds the broken-link check without link evidence", () => {
    const ids = (pages: HealthPageRow[]) =>
      buildPassedChecks([], pages).map((check) => check.id);
    expect(ids([page({ internalLinkCount: 0 })])).not.toContain(
      "no-broken-links",
    );
    expect(ids([page({ internalLinkCount: null })])).not.toContain(
      "no-broken-links",
    );
  });

  it("uses evidence-bounded wording for the broken-link check", () => {
    const checks = buildPassedChecks([], [page({}), page({})]);
    const broken = checks.find((check) => check.id === "no-broken-links")!;
    expect(broken.detail).toBe(
      "No broken internal links were found among the link targets this audit checked.",
    );
    // The old wording claimed every internal link resolved — stronger than the
    // evidence on any crawl, truncated or not.
    expect(broken.detail).not.toContain("Every internal link");
    expect(broken.detail).not.toContain("resolved");
  });

  it("keeps the bounded wording under truncation, partial coverage, and unreached targets", () => {
    const scenarios = {
      // maxPages truncation: only a subset of the previous crawl was fetched.
      truncated: buildPassedChecks([], [page({})]),
      // partial crawl: some pages fetched, others blocked/error.
      partial: buildPassedChecks(
        [],
        [
          page({}),
          page({ url: "https://example.com/blocked", fetchClass: "blocked" }),
          page({ url: "https://example.com/error", fetchClass: "error" }),
        ],
      ),
      // the target that would have been checked sits beyond the crawl limit.
      targetBeyondLimit: buildPassedChecks(
        [],
        [page({ url: "https://example.com/checked" })],
      ),
    };
    for (const checks of Object.values(scenarios)) {
      const broken = checks.find((check) => check.id === "no-broken-links")!;
      expect(broken.detail).toContain(
        "among the link targets this audit checked",
      );
      expect(broken.detail).not.toContain("Every internal link");
    }
  });
});

describe("normalizeAffectedUrl", () => {
  it("strips fragments, sorts queries, lowercases the host", () => {
    expect(normalizeAffectedUrl("https://EXAMPLE.com/p?b=1&a=2#section")).toBe(
      "https://example.com/p?a=2&b=1",
    );
  });
});
