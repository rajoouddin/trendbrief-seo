import { describe, expect, it } from "vitest";
import {
  buildFindings,
  FIX_FIRST_PRIORITY,
  fixTheseFirst,
} from "@/shared/audit-health";
import type { HealthIssueRow, HealthPageRow } from "@/shared/audit-health";

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

describe("sitemap-noindex-conflict prioritisation", () => {
  it("demotes only utility/legal conflicts to Review, not real content URLs", () => {
    const singleConflict = (url: string) =>
      buildFindings(
        [issue("sitemap-noindex-conflict", url)],
        [page({ url, isIndexable: false })],
      )[0];
    const assertBand = (url: string, band: "fix-first" | "review") => {
      const finding = singleConflict(url);
      expect(finding.affected[0].url).toBe(url);
      expect(finding.band).toBe(band);
      expect(finding.priority).toBe(
        band === "review"
          ? undefined
          : FIX_FIRST_PRIORITY.indexOf("sitemap-noindex-conflict"),
      );
    };

    // A real content URL keeps the conflict in "Fix these first".
    assertBand("https://example.com/services/pricing", "fix-first");
    assertBand("https://example.com/unknown-page", "fix-first");
    assertBand("https://example.com/", "fix-first");
    assertBand("https://example.com/resources/guidance", "fix-first");

    // Obviously utility/legal URLs are demoted to Review — the conflict stays
    // a real finding either way.
    assertBand("https://example.com/disclaimer", "review");
    assertBand("https://example.com/privacy-policy", "review");
    assertBand("https://example.com/cookies", "review");
    assertBand("https://example.com/legal/terms", "review");
  });

  it("does not demote a conflict that mixes utility and real URLs", () => {
    const conflict = buildFindings(
      [
        issue("sitemap-noindex-conflict", "https://example.com/disclaimer"),
        issue(
          "sitemap-noindex-conflict",
          "https://example.com/services/pricing",
        ),
      ],
      [
        page({ url: "https://example.com/disclaimer", isIndexable: false }),
        page({
          url: "https://example.com/services/pricing",
          isIndexable: false,
        }),
      ],
    ).find((f) => f.issueType === "sitemap-noindex-conflict")!;
    expect(conflict.band).toBe("fix-first");
    expect(types(fixTheseFirst([conflict]))).toEqual([
      "sitemap-noindex-conflict",
    ]);
  });

  it("stops a utility-only conflict from being the single headline action", () => {
    // Enarra regression: /disclaimer must stay a real (reviewed) finding but
    // must not surface as the sole "Fix these first" rankability action.
    const findings = buildFindings(
      [issue("sitemap-noindex-conflict", "https://enarra.co.uk/disclaimer")],
      [
        page({
          url: "https://enarra.co.uk/disclaimer",
          isIndexable: false,
        }),
      ],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].band).toBe("review");
    expect(fixTheseFirst(findings)).toEqual([]);
  });
});

function types(findings: ReturnType<typeof buildFindings>): string[] {
  return findings.map((finding) => finding.issueType);
}
