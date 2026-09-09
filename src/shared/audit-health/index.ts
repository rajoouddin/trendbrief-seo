/**
 * Website Health presentation model for site audits.
 *
 * Pure functions — no database, no React. Both the server (re-run comparison)
 * and the client (health summary UI) derive their presentation from the exact
 * same rules, so the product's priority and grouping behaviour is testable in
 * isolation and cannot drift between the two sides.
 *
 * Terminology contract: the crawl can determine "indexable" / "non-indexable"
 * (the page's own declared directives plus response signals). It cannot
 * determine "indexed by Google" / "not indexed by Google" — only Google Search
 * Console evidence could, and this feature has none. All copy here uses the
 * former pair.
 *
 * Split for lint-size and clarity: compare.ts (re-run diff), evidence.ts
 * (per-URL evidence + issue-type copy) and identifiers.ts each hold their own
 * domain; types.ts is dependency-free so every module can share it; this
 * module owns the finding grouping and prioritisation.
 */
import { getIssueDescriptor } from "@/shared/audit-issues";
import { sort } from "remeda";
import {
  buildUrlEvidence,
  problemText,
  verifyTextFor,
} from "@/shared/audit-health/evidence";
import { normalizeAffectedUrl } from "@/shared/audit-health/identifiers";
import type {
  Finding,
  FindingBand,
  HealthIssueRow,
  HealthPageRow,
  IssueDetails,
  PassedCheck,
} from "@/shared/audit-health/types";

export type {
  Finding,
  FindingBand,
  FindingEvidence,
  HealthIssueRow,
  HealthPageRow,
  IssueTypeSummary,
  PassedCheck,
  RerunDiff,
} from "@/shared/audit-health/types";
export * from "@/shared/audit-health/compare";
export * from "@/shared/audit-health/evidence";
export {
  hostnameOf,
  normalizeAffectedUrl,
} from "@/shared/audit-health/identifiers";

// ─── "Fix these first" prioritisation ───────────────────────────────────────
//
// Deterministic high-priority classes, ordered. Only these finding types can
// appear in the primary section — everything else is secondary by definition,
// so the excluded noisy/informational checks (thin content, title and
// description length, heading-order skips, ordinary noindex pages, ...) can
// never appear there just because they have rows.
export const FIX_FIRST_PRIORITY: readonly string[] = [
  "blocked-page",
  "server-error",
  "broken-internal-link",
  "sitemap-noindex-conflict",
  "canonical-conflict",
  "missing-title",
  "missing-h1",
];

/** Guards the exclusion rule explicitly so a future addition can't leak in. */
export const NEVER_FIX_FIRST: readonly string[] = [
  "thin-content",
  "title-too-long",
  "title-too-short",
  "meta-description-too-long",
  "meta-description-too-short",
  "heading-order-skip",
  "noindex-page",
];

function resolveSeverity(
  issueType: string,
  rowSeverity: string,
): Finding["severity"] {
  const descriptor = getIssueDescriptor(issueType);
  if (descriptor) return descriptor.severity;
  return rowSeverity === "critical" || rowSeverity === "warning"
    ? rowSeverity
    : "info";
}

function bandFor(
  issueType: string,
  severity: Finding["severity"],
): FindingBand {
  if (FIX_FIRST_PRIORITY.includes(issueType)) return "fix-first";
  if (issueType === "thin-content" || issueType === "slow-response") {
    return "opportunity";
  }
  return severity === "warning" ? "review" : "informational";
}

const BAND_ORDER: FindingBand[] = [
  "fix-first",
  "review",
  "opportunity",
  "informational",
];

function sortFindings(findings: Finding[]): Finding[] {
  const sortKey = (finding: Finding): [number, number, number] =>
    finding.priority !== undefined
      ? [0, finding.priority, 0]
      : [1, BAND_ORDER.indexOf(finding.band), -finding.affectedCount];

  return sort(findings, (a, b) => {
    const [a1, a2, a3] = sortKey(a);
    const [b1, b2, b3] = sortKey(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });
}

/**
 * Build the Website Health findings from persisted issue rows plus the audit's
 * page rows. One finding per issue type, with a distinct-URL affected count
 * and per-URL evidence. Title/H1 findings restrict their affected URLs to the
 * pages the audit has positive evidence is indexable (and, for H1, has some
 * content) before they can appear in the primary section.
 */
export function buildFindings(
  issues: HealthIssueRow[],
  pages: HealthPageRow[],
): Finding[] {
  const pageByUrl = new Map<string, HealthPageRow>();
  for (const page of pages) pageByUrl.set(page.url, page);

  const rowsByType = new Map<string, HealthIssueRow[]>();
  const typeOrder: string[] = [];
  for (const issue of issues) {
    if (!rowsByType.has(issue.issueType)) {
      rowsByType.set(issue.issueType, []);
      typeOrder.push(issue.issueType);
    }
    rowsByType.get(issue.issueType)!.push(issue);
  }

  const findings: Finding[] = [];
  for (const issueType of typeOrder) {
    const rows = rowsByType.get(issueType)!;
    const descriptor = getIssueDescriptor(issueType);
    const requiresIndexable =
      issueType === "missing-title" || issueType === "missing-h1";

    const seen = new Set<string>();
    const affected: Finding["affected"] = [];
    for (const row of rows) {
      const key = normalizeAffectedUrl(row.pageUrl);
      if (seen.has(key)) continue;
      seen.add(key);

      const page = pageByUrl.get(row.pageUrl);
      if (requiresIndexable && (!page || !page.isIndexable)) continue;
      if (issueType === "missing-h1" && page && (page.wordCount ?? 0) === 0) {
        continue;
      }

      affected.push({
        url: row.pageUrl,
        evidence: buildUrlEvidence(row, page),
      });
    }

    if (affected.length === 0) continue;

    const severity = resolveSeverity(issueType, rows[0].severity);
    const priority = FIX_FIRST_PRIORITY.indexOf(issueType);
    findings.push({
      issueType,
      severity,
      title: descriptor?.title ?? issueType,
      problem: problemText(issueType, parseFirstDetails(rows[0].detailsJson)),
      whyItMatters: descriptor?.explanation ?? "",
      whatToDo: descriptor?.howToFix ?? "",
      howToVerify: verifyTextFor(issueType),
      band: bandFor(issueType, severity),
      priority: priority >= 0 ? priority : undefined,
      affectedCount: affected.length,
      affected,
    });
  }

  return sortFindings(findings);
}

function parseFirstDetails(
  detailsJson: string | null | undefined,
): IssueDetails {
  if (!detailsJson) return {};
  try {
    const value: unknown = JSON.parse(detailsJson);
    if (!!value && typeof value === "object" && !Array.isArray(value)) {
      const result: IssueDetails = {};
      for (const entry of Object.entries(value)) {
        result[entry[0]] = entry[1];
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

export function fixTheseFirst(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.band === "fix-first");
}

export function otherFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.band !== "fix-first");
}

// ─── Passed checks ──────────────────────────────────────────────────────────
// Only claimed when the audit has enough evidence to make the statement:
// the relevant issue type has zero rows and at least one page was crawled.

export function buildPassedChecks(
  issues: HealthIssueRow[],
  pages: HealthPageRow[],
): PassedCheck[] {
  if (pages.length === 0) return [];
  const present = new Set(issues.map((issue) => issue.issueType));
  const checks: PassedCheck[] = [];

  if (!present.has("broken-internal-link")) {
    checks.push({
      id: "no-broken-links",
      title: "No broken internal links found",
      detail: `Every internal link across ${pages.length} crawled page(s) resolved without a client or server error.`,
    });
  }
  if (!present.has("server-error")) {
    checks.push({
      id: "no-server-errors",
      title: "No server errors detected",
      detail: "No crawled page returned a 5xx response.",
    });
  }
  if (!present.has("canonical-conflict")) {
    checks.push({
      id: "canonical-consistent",
      title: "Canonical signals consistent",
      detail:
        "No page declared conflicting canonical signals between its HTML and HTTP headers.",
    });
  }
  if (pages.some((page) => page.inSitemap)) {
    checks.push({
      id: "sitemap-found",
      title: "Sitemap successfully discovered",
      detail: "The audit found and read the site's sitemap entries.",
    });
  }

  return checks;
}
