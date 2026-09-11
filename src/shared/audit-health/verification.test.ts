import { describe, expect, it } from "vitest";
import {
  diffFindings,
  verificationRequirement,
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

describe("verificationRequirement — issue-aware classes", () => {
  it("classifies page-local issue types as page-verifiable", () => {
    for (const type of [
      "missing-title",
      "missing-h1",
      "title-too-long",
      "title-too-short",
      "meta-description-too-long",
      "meta-description-too-short",
      "heading-order-skip",
      "noindex-page",
      "thin-content",
      "missing-meta-description",
      "multiple-h1",
      "canonical-conflict",
      "canonicalized-page",
      "sitemap-noindex-conflict",
      "no-outgoing-links",
      "slow-response",
      "server-error",
      "blocked-page",
      "broken-page",
      "images-missing-alt",
    ]) {
      expect(verificationRequirement(type), type).toBe("page");
    }
  });

  it("classifies cross-resource issue types as requiring dedicated evidence", () => {
    expect(verificationRequirement("broken-internal-link")).toBe(
      "brokenTarget",
    );
    expect(verificationRequirement("duplicate-title")).toBe("duplicateGroup");
    expect(verificationRequirement("duplicate-meta-description")).toBe(
      "duplicateGroup",
    );
    expect(verificationRequirement("duplicate-content")).toBe("duplicateGroup");
    expect(verificationRequirement("redirect-chain")).toBe("redirectPath");
    expect(verificationRequirement("redirect-loop")).toBe("redirectPath");
    expect(verificationRequirement("orphan-page")).toBe("linkGraph");
    expect(verificationRequirement("deep-page")).toBe("linkGraph");
  });

  it("defaults unknown issue types to unsupported", () => {
    expect(verificationRequirement("mystery-issue")).toBe("unsupported");
    expect(verificationRequirement("")).toBe("unsupported");
  });
});

describe("diffFindings — page-local verification", () => {
  it("marks page-local findings Fixed only when the page was re-evaluated", () => {
    const previous = [
      issue("missing-title", "https://example.com/evaluated"),
      issue("missing-title", "https://example.com/skipped"),
    ];
    const pages = [evaluatedPage("https://example.com/evaluated")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].sampleUrls).toEqual(["https://example.com/evaluated"]);
    expect(diff.unverified[0].sampleUrls).toEqual([
      "https://example.com/skipped",
    ]);
  });

  it("keeps page-local findings that are still present in Remaining", () => {
    const previous = [issue("missing-title", "https://example.com/a")];
    const current = [issue("missing-title", "https://example.com/a")];
    const pages = [evaluatedPage("https://example.com/a")];
    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(1);
    expect(diff.fixed).toEqual([]);
  });
});

describe("diffFindings — duplicate-group verification", () => {
  it("keeps the group in Remaining while a duplicate peer is still present", () => {
    const previous = [
      issue("duplicate-title", "https://example.com/a", {
        groupSize: 2,
        otherUrls: ["https://example.com/b"],
      }),
    ];
    const current = [
      issue("duplicate-title", "https://example.com/a", {
        groupSize: 2,
        otherUrls: ["https://example.com/b"],
      }),
    ];
    const pages = [
      { ...evaluatedPage("https://example.com/a"), title: "Shared" },
      { ...evaluatedPage("https://example.com/b"), title: "Shared" },
    ];
    const diff = diffFindings(current, previous, pages);
    expect(diff.remaining[0].affected).toBe(1);
    expect(diff.fixed).toEqual([]);
  });

  it("marks Fixed when the peer was re-evaluated and the group dissolved", () => {
    const previous = [
      issue("duplicate-title", "https://example.com/a", {
        groupSize: 2,
        otherUrls: ["https://example.com/b"],
      }),
    ];
    const pages = [
      { ...evaluatedPage("https://example.com/a"), title: "Shared title" },
      { ...evaluatedPage("https://example.com/b"), title: "Now unique" },
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
    expect(diff.unverified).toEqual([]);
  });

  it("keeps an omitted duplicate peer in Unverified", () => {
    const previous = [
      issue("duplicate-title", "https://example.com/a", {
        groupSize: 2,
        otherUrls: ["https://example.com/b"],
      }),
    ];
    // The current audit only crawled the affected page; peer /b is missing.
    const pages = [
      { ...evaluatedPage("https://example.com/a"), title: "Shared" },
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps an incomplete comparison set in Unverified", () => {
    const previous = [
      issue("duplicate-title", "https://example.com/a", {
        groupSize: 5,
        otherUrls: ["https://example.com/b", "https://example.com/c"],
      }),
    ];
    // Every known member was re-evaluated with distinct titles, but the group
    // was recorded as 5 pages and only 3 are known — the unseen members could
    // have been missed, not fixed.
    const pages = [
      { ...evaluatedPage("https://example.com/a"), title: "Alpha" },
      { ...evaluatedPage("https://example.com/b"), title: "Beta" },
      { ...evaluatedPage("https://example.com/c"), title: "Gamma" },
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("keeps a legacy duplicate row without group detail in Unverified", () => {
    const previous = [issue("duplicate-title", "https://example.com/a")];
    const pages = [evaluatedPage("https://example.com/a")];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed).toEqual([]);
    expect(diff.unverified[0].affected).toBe(1);
  });

  it("marks Fixed for content duplicates after both pages were re-evaluated", () => {
    const previous = [
      issue("duplicate-content", "https://example.com/a", {
        groupSize: 2,
        otherUrls: ["https://example.com/b"],
      }),
    ];
    const pages = [
      {
        ...evaluatedPage("https://example.com/a"),
        contentHash: "abc",
        wordCount: 400,
      },
      {
        ...evaluatedPage("https://example.com/b"),
        contentHash: "xyz",
        wordCount: 400,
      },
    ];
    const diff = diffFindings([], previous, pages);
    expect(diff.fixed[0].affected).toBe(1);
  });
});
