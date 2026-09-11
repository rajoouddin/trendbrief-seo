import { describe, expect, it } from "vitest";
import { diffFindings } from "@/shared/audit-health/compare";
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

function redirectPage(
  url: string,
  redirectUrl: string,
  statusCode = 301,
): HealthPageRow {
  return {
    url,
    statusCode,
    title: "Example",
    isIndexable: true,
    inSitemap: true,
    fetchClass: "ok",
    redirectUrl,
  };
}

describe("diffFindings — orphan-page verification", () => {
  it("keeps an orphan that is still reported in Remaining", () => {
    const previous = [issue("orphan-page", "https://example.com/deep")];
    const current = [issue("orphan-page", "https://example.com/deep")];
    const pages = [evaluatedPage("https://example.com/deep")];
    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(1);
  });

  it("never calls a disappeared orphan Fixed when the crawl may have been truncated", () => {
    const previous = [issue("orphan-page", "https://example.com/deep")];
    // Page re-crawled and the orphan row is absent — but the fetch alone says
    // nothing about the internal-link graph.
    const pages = [evaluatedPage("https://example.com/deep")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("never calls a disappeared orphan Fixed when the graph check was suppressed", () => {
    const previous = [issue("orphan-page", "https://example.com/deep")];
    const pages = [evaluatedPage("https://example.com/deep")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("marks Fixed only with positive inlink evidence, which P0 does not persist", () => {
    const previous = [issue("orphan-page", "https://example.com/deep")];
    const pages = [
      evaluatedPage("https://example.com/deep"),
      evaluatedPage("https://example.com/elsewhere"),
    ];
    const diff = diffFindings([], previous, pages);
    // Until a persisted link graph exists, no positive inlink evidence is
    // available, so the answer is conservative Unverified.
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });
});

describe("diffFindings — redirect verification", () => {
  it("keeps a chain that still exists in Remaining", () => {
    const previous = [
      issue("redirect-chain", "https://example.com/a", {
        hops: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
      }),
    ];
    const current = [
      issue("redirect-chain", "https://example.com/a", {
        hops: [
          "https://example.com/a",
          "https://example.com/x",
          "https://example.com/y",
        ],
      }),
    ];
    const pages = [
      redirectPage("https://example.com/a", "https://example.com/x"),
      redirectPage("https://example.com/x", "https://example.com/y"),
      evaluatedPage("https://example.com/y"),
    ];
    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(1);
    expect(diff.fixed).toEqual([]);
  });

  it("marks Fixed when the chain shortens to a single redirect with all hops evaluated", () => {
    const previous = [
      issue("redirect-chain", "https://example.com/a", {
        hops: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
      }),
    ];
    const pages = [
      redirectPage("https://example.com/a", "https://example.com/final"),
      evaluatedPage("https://example.com/final"),
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
    expect(diff.unverified).toEqual([]);
  });

  it("keeps a chain with unmapped downstream hops in Unverified", () => {
    const previous = [
      issue("redirect-chain", "https://example.com/a", {
        hops: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
      }),
    ];
    // /z is not present in the current crawl — the hop was not observed.
    const pages = [
      redirectPage("https://example.com/a", "https://example.com/z"),
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("marks a redirect loop Fixed only when the current path terminates", () => {
    const previous = [
      issue("redirect-loop", "https://example.com/a", {
        hops: ["https://example.com/a", "https://example.com/a"],
      }),
    ];
    const pages = [
      redirectPage("https://example.com/a", "https://example.com/final"),
      evaluatedPage("https://example.com/final"),
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
  });

  it("keeps a loop with missing loop evidence in Unverified", () => {
    const previous = [issue("redirect-loop", "https://example.com/a")];
    const pages = [evaluatedPage("https://example.com/a")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps a loop that still cycles in Remaining when reported, else Unverified", () => {
    const previous = [
      issue("redirect-loop", "https://example.com/a", {
        hops: ["https://example.com/a", "https://example.com/b"],
      }),
    ];
    const current = [
      issue("redirect-loop", "https://example.com/a", {
        hops: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/a",
        ],
      }),
    ];
    const pages = [
      redirectPage("https://example.com/a", "https://example.com/b"),
      redirectPage("https://example.com/b", "https://example.com/a"),
    ];
    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(1);
    expect(diff.fixed).toEqual([]);
  });
});

describe("diffFindings — broken-link legacy safety", () => {
  it("marks Fixed when the target was recrawled healthy", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/old",
        targetStatus: 404,
      }),
    ];
    const pages = [
      evaluatedPage("https://example.com/source"),
      evaluatedPage("https://example.com/old"),
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
  });

  it("keeps a still-broken target out of Fixed when no current row exists", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/old",
        targetStatus: 404,
      }),
    ];
    const pages = [
      evaluatedPage("https://example.com/source"),
      evaluatedPage("https://example.com/old", 404),
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps a legacy row with a missing target in Unverified", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetStatus: 404,
      }),
    ];
    const pages = [evaluatedPage("https://example.com/source")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps a malformed legacy target in Unverified", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "",
        targetStatus: 404,
      }),
    ];
    const pages = [evaluatedPage("https://example.com/source")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps an unresolved (blocked) target in Unverified", () => {
    const previous = [
      issue("broken-internal-link", "https://example.com/source", {
        targetUrl: "https://example.com/blocked-target",
        targetStatus: 404,
      }),
    ];
    const pages = [
      evaluatedPage("https://example.com/source"),
      {
        ...evaluatedPage("https://example.com/blocked-target"),
        fetchClass: "blocked",
        statusCode: 403,
      },
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });
});

describe("diffFindings — sitemap/noindex conflict verification", () => {
  const noindexPage = (url: string, inSitemap: boolean): HealthPageRow => ({
    ...evaluatedPage(url),
    isIndexable: false,
    inSitemap,
  });

  it("keeps the conflict in Remaining while it is still reported", () => {
    const previous = [
      issue("sitemap-noindex-conflict", "https://example.com/private", {
        inSitemap: true,
        noindexVia: "robotsMeta",
      }),
    ];
    const current = [
      issue("sitemap-noindex-conflict", "https://example.com/private", {}),
    ];
    const pages = [noindexPage("https://example.com/private", true)];
    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(1);
    expect(diff.fixed).toEqual([]);
  });

  it("never calls a disappeared conflict Fixed when the page is still noindex and sitemap evidence is missing", () => {
    // Codex reproduction: the page recrawls, stays non-indexable, but sitemap
    // discovery failed this run, so inSitemap fell back to false and the
    // finding row disappeared. Absence does not prove the conflict is gone.
    const previous = [
      issue("sitemap-noindex-conflict", "https://example.com/private", {
        inSitemap: true,
        noindexVia: "robotsMeta",
      }),
    ];
    const pages = [noindexPage("https://example.com/private", false)];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps a conflict with a never-recrawled page in Unverified", () => {
    const previous = [
      issue("sitemap-noindex-conflict", "https://example.com/private", {}),
    ];
    const pages: HealthPageRow[] = [];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("marks a disappeared conflict Fixed only when the page itself became indexable", () => {
    const previous = [
      issue("sitemap-noindex-conflict", "https://example.com/private", {}),
    ];
    // The page was positively re-evaluated and is indexable now: the conflict
    // (which requires a non-indexable page) cannot exist, even without new
    // sitemap evidence.
    const pages = [
      { ...evaluatedPage("https://example.com/private"), inSitemap: false },
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
    expect(diff.unverified).toEqual([]);
  });

  it("never lets a transient sitemap failure produce Fixed", () => {
    // Even with the page recorded as not-in-sitemap (the fallback when
    // discovery failed to run this time), a still-noindex page cannot be
    // proven absent from a successfully evaluated sitemap.
    const previous = [
      issue("sitemap-noindex-conflict", "https://example.com/private", {}),
    ];
    const pages = [noindexPage("https://example.com/private", false)];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });
});

describe("diffFindings — unknown issue types", () => {
  it("never marks a disappeared unknown issue Fixed", () => {
    const previous = [issue("mystery-issue", "https://example.com/a")];
    const pages = [evaluatedPage("https://example.com/a")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });
});
