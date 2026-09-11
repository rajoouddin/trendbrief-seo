import { describe, expect, it } from "vitest";
import {
  buildRerunDiff,
  compareOrigins,
  issueIdentityKey,
} from "@/shared/audit-health/compare";
import { normalizeAffectedUrl } from "@/shared/audit-health/identifiers";
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

describe("compareOrigins — migration-aware comparison", () => {
  it("reports no change for the same origin", () => {
    const info = compareOrigins(
      "https://example.com/start",
      "https://example.com/start",
    );
    expect(info?.changed).toBe(false);
  });

  it("flags an HTTP to HTTPS origin migration", () => {
    const info = compareOrigins(
      "http://example.com/start",
      "https://example.com/start",
    );
    expect(info?.changed).toBe(true);
    expect(info?.previousOrigin).toBe("http://example.com");
    expect(info?.currentOrigin).toBe("https://example.com");
    expect(info?.note).toContain("HTTP");
  });

  it("flags an HTTPS to HTTP origin migration", () => {
    const info = compareOrigins(
      "https://example.com/start",
      "http://example.com/start",
    );
    expect(info?.changed).toBe(true);
  });

  it("flags a www to apex origin migration", () => {
    const info = compareOrigins(
      "https://www.example.com/start",
      "https://example.com/start",
    );
    expect(info?.changed).toBe(true);
  });

  it("flags an apex to www origin migration", () => {
    const info = compareOrigins(
      "https://example.com/start",
      "https://www.example.com/start",
    );
    expect(info?.changed).toBe(true);
  });

  it("returns null for an unparseable start URL", () => {
    expect(compareOrigins("not a url", "https://example.com/start")).toBeNull();
  });
});

describe("buildRerunDiff — migration state propagation", () => {
  const rerun = (previousStartUrl: string, currentStartUrl: string) =>
    buildRerunDiff({
      currentIssues: [],
      previousIssues: [issue("missing-title", "http://example.com/a")],
      currentPages: [evaluatedPage("https://example.com/a")],
      currentScope: { pagesCrawled: 10, maxPages: 50 },
      previousScope: { pagesCrawled: 10, maxPages: 50 },
      sameSite: true,
      currentStartedAt: "2026-09-01T00:00:00Z",
      previousStartedAt: "2026-08-01T00:00:00Z",
      currentStartUrl,
      previousStartUrl,
    });

  it("marks originChanged when the audit origin migrated", () => {
    const diff = rerun("http://example.com/", "https://example.com/");
    expect(diff.originChanged?.changed).toBe(true);
    // The old http finding must never become Fixed just because the site
    // migrated to https; its URL was not re-crawled.
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("does not mark originChanged for identical origins", () => {
    const diff = buildRerunDiff({
      currentIssues: [],
      previousIssues: [issue("missing-title", "https://example.com/a")],
      currentPages: [evaluatedPage("https://example.com/a")],
      currentScope: { pagesCrawled: 10, maxPages: 50 },
      previousScope: { pagesCrawled: 10, maxPages: 50 },
      sameSite: true,
      currentStartedAt: "2026-09-01T00:00:00Z",
      previousStartedAt: "2026-08-01T00:00:00Z",
      currentStartUrl: "https://example.com/",
      previousStartUrl: "https://example.com/",
    });
    expect(diff.originChanged?.changed).toBe(false);
    expect(diff.fixed[0].affected).toBe(1);
  });
});

describe("normalizeAffectedUrl — percent encoding identity", () => {
  it("equates an encoded unreserved tilde with its literal form", () => {
    expect(normalizeAffectedUrl("https://example.com/a%7Eb")).toBe(
      normalizeAffectedUrl("https://example.com/a~b"),
    );
    expect(normalizeAffectedUrl("https://example.com/a%7eb")).toBe(
      normalizeAffectedUrl("https://example.com/a~b"),
    );
  });

  it("uppercases percent-hex digits", () => {
    expect(normalizeAffectedUrl("https://example.com/a%2fb")).toBe(
      "https://example.com/a%2Fb",
    );
  });

  it("preserves reserved-character semantics", () => {
    // %2F stays percent-encoded and distinct from a literal path separator.
    expect(normalizeAffectedUrl("https://example.com/a%2Fb")).toBe(
      "https://example.com/a%2Fb",
    );
    expect(normalizeAffectedUrl("https://example.com/a%2Fb")).not.toBe(
      normalizeAffectedUrl("https://example.com/a/b"),
    );
  });

  it("keeps identities distinct across encoded and literal reserved forms", () => {
    const encoded = issueIdentityKey(
      issue("missing-title", "https://example.com/a%2Fb"),
    );
    const literal = issueIdentityKey(
      issue("missing-title", "https://example.com/a/b"),
    );
    expect(encoded).not.toBe(literal);
  });
});
