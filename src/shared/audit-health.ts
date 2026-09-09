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
 */
import {
  getIssueDescriptor,
  ISSUE_SEVERITY_ORDER,
  type IssueSeverity,
} from "./audit-issues";

// ─── Input row shapes (structural subsets of the persisted rows) ───────────

export interface HealthIssueRow {
  id: string;
  pageId?: string | null;
  pageUrl: string;
  issueType: string;
  severity: string;
  detailsJson?: string | null;
}

export interface HealthPageRow {
  url: string;
  statusCode: number | null;
  title: string | null;
  metaDescription?: string | null;
  isIndexable: boolean;
  inSitemap: boolean;
  wordCount?: number | null;
  canonicalUrl?: string | null;
  robotsMeta?: string | null;
  xRobotsTag?: string | null;
}

// ─── Presentation model ─────────────────────────────────────────────────────

/** "fix-first" = primary P0 section; the rest are secondary bands. */
export type FindingBand =
  | "fix-first"
  | "review"
  | "opportunity"
  | "informational";

export interface FindingEvidence {
  label: string;
  value: string;
}

export interface Finding {
  issueType: string;
  severity: IssueSeverity;
  title: string;
  /** What was detected, phrased deterministically from crawl evidence. */
  problem: string;
  /** Why it matters. */
  whyItMatters: string;
  /** Concrete remediation. */
  whatToDo: string;
  /** What a successful re-run should show. */
  howToVerify: string;
  band: FindingBand;
  /** Position within "Fix these first"; undefined for secondary findings. */
  priority?: number;
  /** Number of distinct affected URLs displayed. */
  affectedCount: number;
  affected: Array<{ url: string; evidence: FindingEvidence[] }>;
}

export interface PassedCheck {
  id: string;
  title: string;
  detail: string;
}

export interface ScopeInfo {
  pagesCrawled: number;
  maxPages: number;
}

export interface IssueTypeSummary {
  issueType: string;
  title: string;
  affected: number;
  sampleUrls: string[];
}

export interface RerunDiff {
  comparable: boolean;
  reason?: "no-previous" | "different-site" | "incomplete";
  sameSite?: boolean;
  scopeChanged?: boolean;
  scopeNote?: string;
  previous: {
    startedAt: string;
    pagesCrawled: number;
    maxPages: number;
  } | null;
  current: { startedAt: string; pagesCrawled: number; maxPages: number } | null;
  fixed: IssueTypeSummary[];
  remaining: IssueTypeSummary[];
  newly: IssueTypeSummary[];
}

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

// ─── Issue-type copy not covered by the shared registry ─────────────────────
// Deterministic "problem" statements and re-run verification guidance per
// type. Remediation ("what to do") lives in the shared issue registry.

const PROBLEM: Record<string, string> = {
  "blocked-page":
    "The site's bot protection challenged our crawler instead of serving the page, so the page could not be audited.",
  "server-error": "The URL returned a 5xx server error.",
  "broken-internal-link":
    "This page links to an internal URL that returned an error status.",
  "sitemap-noindex-conflict":
    "The URL is listed in the sitemap and the page itself sends a noindex signal.",
  "canonical-conflict":
    "The page declares a different canonical URL in its HTML and its HTTP Link header.",
  "missing-title": "This indexable page has no <title> tag.",
  "missing-h1": "This indexable page has no H1 heading.",
  "broken-page": "The URL returned a 4xx client error.",
  "missing-meta-description": "This page has no meta description.",
  "multiple-h1": "The page has more than one H1 heading.",
  "duplicate-title": "This title is shared with other pages.",
  "duplicate-meta-description":
    "This meta description is shared with other pages.",
  "duplicate-content": "The visible text is identical to another URL's.",
  "redirect-chain":
    "Reaching this page takes two or more consecutive redirects.",
  "redirect-loop": "The redirect points back into itself and never resolves.",
  "thin-content": "The page has very little visible text.",
  "images-missing-alt": "One or more images on the page lack alt text.",
  "orphan-page": "No crawled page links to this URL.",
  "no-outgoing-links": "The page contains no outgoing links.",
  "noindex-page": "The page tells search engines not to index it.",
  "canonicalized-page": "The page declares another URL as its canonical.",
  "deep-page": "The page is deep in the site structure.",
};

type Details = Record<string, unknown>;

const PROBLEM_WITH_EVIDENCE: Record<string, (details: Details) => string> = {
  "title-too-long": (details) =>
    `The title is ${details.length ?? "?"} characters — over the ~60 character guideline.`,
  "title-too-short": (details) =>
    `The title is ${details.length ?? "?"} characters — under the ~10 character guideline.`,
  "meta-description-too-long": (details) =>
    `The meta description is ${details.length ?? "?"} characters — over the ~160 character guideline.`,
  "meta-description-too-short": (details) =>
    `The meta description is ${details.length ?? "?"} characters — under the ~70 character guideline.`,
  "heading-order-skip": () =>
    "The heading hierarchy skips levels (e.g. H2 followed by H4).",
  "slow-response": (details) =>
    `The server took ${details.responseTimeMs ?? "?"}ms to respond — over the 1.5s guideline.`,
};

const HOW_TO_VERIFY: Record<string, string> = {
  "blocked-page":
    "Re-run the audit after adjusting the bot-protection rules. The finding disappears once the crawler can read the page.",
  "server-error":
    "Re-run the audit after fixing the underlying error. The finding disappears once the page returns a successful response.",
  "broken-internal-link":
    "Re-run the audit after updating or removing the link. The finding disappears once every internal link resolves to a live page.",
  "sitemap-noindex-conflict":
    "Re-run the audit after the page and sitemap agree on indexability. The finding disappears once the page is either indexable and in the sitemap, or non-indexable and out of it.",
  "canonical-conflict":
    "Re-run the audit after picking one canonical declaration. The finding disappears once the HTML and header canonicals match.",
  "missing-title":
    "Re-run the audit after adding a title. The finding disappears once the page has a <title> tag.",
  "missing-h1":
    "Re-run the audit after adding an H1. The finding disappears once the page has an H1 heading.",
  "broken-page":
    "Re-run the audit after restoring, redirecting, or removing the URL. The finding disappears once the URL returns a successful response or is gone from the crawl.",
  "missing-meta-description":
    "Re-run the audit after adding a description. The finding disappears once the page has a meta description.",
  "multiple-h1":
    "Re-run the audit after demoting the extra H1s. The finding disappears once the page has a single H1.",
  "duplicate-title":
    "Re-run the audit after making the titles unique. The finding disappears once no two pages share this title.",
  "duplicate-meta-description":
    "Re-run the audit after making the descriptions unique. The finding disappears once no two pages share this description.",
  "duplicate-content":
    "Re-run the audit after consolidating the duplicates. The finding disappears once each URL serves distinct content.",
  "redirect-chain":
    "Re-run the audit after pointing the links at the final URL. The finding disappears once the page is reachable in one redirect or none.",
  "redirect-loop":
    "Re-run the audit after fixing the redirect rules. The finding disappears once the URL resolves to a final 200 page.",
  "thin-content":
    "Re-run the audit after expanding the page or deliberately marking it non-indexable. The finding disappears once the page has substantially more content or no longer asks to be indexed.",
  "images-missing-alt":
    "Re-run the audit after adding alt text. The finding disappears once every meaningful image has alt text.",
  "orphan-page":
    "Re-run the audit after linking to the page. The finding disappears once another crawled page links to it.",
  "no-outgoing-links":
    "Re-run the audit after adding onward links. The finding disappears once the page contains at least one link.",
  "noindex-page":
    "Re-run the audit after changing the directive if it was unintended. The finding disappears once the page is indexable — or stays as a confirmation that the noindex is intentional.",
  "canonicalized-page":
    "Re-run the audit after setting the canonical to the page itself if it should rank. The finding disappears once the page declares itself canonical — or stays as a confirmation that the canonicalization is intentional.",
  "deep-page":
    "Re-run the audit after adding links from higher-level pages. The finding disappears once the page is within a few clicks of the homepage.",
  "title-too-long":
    "Re-run the audit after shortening the title. The finding disappears once the title fits the guideline.",
  "title-too-short":
    "Re-run the audit after expanding the title. The finding disappears once the title is descriptive.",
  "meta-description-too-long":
    "Re-run the audit after trimming the description. The finding disappears once it fits the guideline.",
  "meta-description-too-short":
    "Re-run the audit after expanding the description. The finding disappears once it is descriptive.",
  "heading-order-skip":
    "Re-run the audit after fixing the heading levels. The finding disappears once the headings descend one level at a time.",
  "slow-response":
    "Re-run the audit after addressing server time. The finding disappears once the response is consistently under the threshold.",
};

const FALLBACK_VERIFY =
  "Re-run the audit after making the change. This finding should disappear for the affected URL(s).";

function problemText(issueType: string, details: Details): string {
  const withEvidence = PROBLEM_WITH_EVIDENCE[issueType];
  if (withEvidence) return withEvidence(details);
  return PROBLEM[issueType] ?? issueType;
}

// ─── URL normalisation ──────────────────────────────────────────────────────
// Matches the crawler's own normalisation (fragment stripped, query params
// sorted, host lowercase) so finding identities are stable across audits even
// when the page's exact URL string or query order changed.

export function normalizeAffectedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// ─── Evidence ───────────────────────────────────────────────────────────────

function parseDetails(detailsJson: string | null | undefined): Details {
  if (!detailsJson) return {};
  try {
    const value: unknown = JSON.parse(detailsJson);
    return !!value && typeof value === "object" && !Array.isArray(value)
      ? (value as Details)
      : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const STATUS_EVIDENCE_TYPES = new Set([
  "blocked-page",
  "server-error",
  "broken-page",
]);

/**
 * Pre-rendered evidence lines for one affected URL. Layered from persisted
 * page data plus the row's own details. Never falls back to dumping the raw
 * details JSON — unknown detail keys are ignored.
 */
export function buildUrlEvidence(
  issue: HealthIssueRow,
  page?: HealthPageRow,
): FindingEvidence[] {
  const details = parseDetails(issue.detailsJson);
  const out: FindingEvidence[] = [];

  if (STATUS_EVIDENCE_TYPES.has(issue.issueType) && page?.statusCode != null) {
    out.push({ label: "HTTP status", value: String(page.statusCode) });
  }

  switch (issue.issueType) {
    case "broken-internal-link": {
      const target = asString(details.targetUrl);
      if (target) out.push({ label: "Link target", value: target });
      if (details.targetStatus != null) {
        out.push({
          label: "Target status",
          value: String(details.targetStatus),
        });
      }
      break;
    }
    case "sitemap-noindex-conflict": {
      out.push({ label: "Sitemap", value: "listed" });
      const directive =
        asString(details.robotsMeta) ?? asString(details.xRobotsTag);
      if (directive) out.push({ label: "Noindex signal", value: directive });
      break;
    }
    case "canonical-conflict": {
      const html = asString(details.htmlCanonical);
      if (html) out.push({ label: "HTML canonical", value: html });
      const header = asString(details.headerCanonical);
      if (header) out.push({ label: "Header canonical", value: header });
      break;
    }
    case "canonicalized-page": {
      const canonical = asString(details.canonicalUrl);
      if (canonical) out.push({ label: "Canonical target", value: canonical });
      break;
    }
    case "noindex-page": {
      const directive =
        asString(details.robotsMeta) ?? asString(details.xRobotsTag);
      if (directive) out.push({ label: "Noindex signal", value: directive });
      break;
    }
    case "title-too-long":
    case "title-too-short": {
      if (page) {
        out.push({ label: "Current title", value: page.title ?? "(none)" });
      }
      if (details.length != null) {
        out.push({ label: "Length", value: `${details.length} characters` });
      }
      break;
    }
    case "meta-description-too-long":
    case "meta-description-too-short": {
      if (page) {
        out.push({
          label: "Current description",
          value: page.metaDescription ?? "(none)",
        });
      }
      if (details.length != null) {
        out.push({ label: "Length", value: `${details.length} characters` });
      }
      break;
    }
    case "missing-title":
      if (page) out.push({ label: "Current title", value: "(none)" });
      break;
    case "missing-meta-description":
      if (page) out.push({ label: "Current description", value: "(none)" });
      break;
    case "thin-content":
      if (page)
        out.push({ label: "Words", value: String(page.wordCount ?? 0) });
      break;
    case "images-missing-alt":
      if (details.imagesMissingAlt != null) {
        out.push({
          label: "Images missing alt",
          value: `${details.imagesMissingAlt} of ${details.imagesTotal ?? "?"}`,
        });
      }
      break;
    case "slow-response":
      if (details.responseTimeMs != null) {
        out.push({
          label: "Response time",
          value: `${details.responseTimeMs}ms`,
        });
      }
      break;
    case "deep-page":
      if (details.crawlDepth != null) {
        out.push({ label: "Depth", value: `${details.crawlDepth} clicks` });
      }
      break;
    case "duplicate-title":
    case "duplicate-meta-description":
    case "duplicate-content": {
      if (details.groupSize != null) {
        out.push({
          label: "Duplicate group",
          value: `${details.groupSize} pages share this`,
        });
      }
      break;
    }
    case "redirect-chain":
    case "redirect-loop": {
      const hops = details.hops;
      if (Array.isArray(hops) && hops.length > 0) {
        out.push({
          label: "Redirect path",
          value:
            hops
              .slice(0, 6)
              .map((hop) => String(hop))
              .join(" → ") + (hops.length > 6 ? " → …" : ""),
        });
      }
      if (issue.issueType === "redirect-chain" && details.finalUrl != null) {
        out.push({ label: "Final URL", value: String(details.finalUrl) });
      }
      break;
    }
    case "multiple-h1":
      if (details.h1Count != null) {
        out.push({ label: "H1 count", value: String(details.h1Count) });
      }
      break;
    default:
      break;
  }

  return out;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

function resolveSeverity(
  issueType: string,
  rowSeverity: string,
): IssueSeverity {
  const descriptor = getIssueDescriptor(issueType);
  if (descriptor) return descriptor.severity;
  return rowSeverity === "critical" || rowSeverity === "warning"
    ? rowSeverity
    : "info";
}

function bandFor(issueType: string, severity: IssueSeverity): FindingBand {
  if (FIX_FIRST_PRIORITY.includes(issueType)) return "fix-first";
  if (issueType === "thin-content" || issueType === "slow-response") {
    return "opportunity";
  }
  return severity === "warning" ? "review" : "informational";
}

function sortKey(finding: Finding): [number, number, number] {
  if (finding.priority !== undefined) return [0, finding.priority, 0];
  return [1, BAND_ORDER.indexOf(finding.band), -finding.affectedCount];
}

const BAND_ORDER: FindingBand[] = [
  "fix-first",
  "review",
  "opportunity",
  "informational",
];

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
    const affected: Array<{ url: string; evidence: FindingEvidence[] }> = [];
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
      problem: problemText(issueType, parseDetails(rows[0].detailsJson)),
      whyItMatters: descriptor?.explanation ?? "",
      whatToDo: descriptor?.howToFix ?? "",
      howToVerify: HOW_TO_VERIFY[issueType] ?? FALLBACK_VERIFY,
      band: bandFor(issueType, severity),
      priority: priority >= 0 ? priority : undefined,
      affectedCount: affected.length,
      affected,
    });
  }

  return [...findings].sort((a, b) => {
    const [ka1, ka2, ka3] = sortKey(a);
    const [kb1, kb2, kb3] = sortKey(b);
    return ka1 - kb1 || ka2 - kb2 || ka3 - kb3;
  });
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

// ─── Re-run comparison ──────────────────────────────────────────────────────

interface IssueIdentity {
  issueType: string;
  url: string;
}

function summaryOf(identities: IssueIdentity[]): IssueTypeSummary[] {
  const byType = new Map<string, IssueIdentity[]>();
  for (const identity of identities) {
    const list = byType.get(identity.issueType) ?? [];
    list.push(identity);
    byType.set(identity.issueType, list);
  }
  return Array.from(byType.values())
    .map((rows) => ({
      issueType: rows[0].issueType,
      title: getIssueDescriptor(rows[0].issueType)?.title ?? rows[0].issueType,
      affected: rows.length,
      sampleUrls: rows.slice(0, 3).map((row) => row.url),
    }))
    .sort((a, b) => b.affected - a.affected);
}

/**
 * Deterministic re-run diff between two audits' findings, keyed by
 * (normalized affected URL, issue type). A grouped issue's Fixed/Remaining/New
 * breakdown is derived from these URL-level identities.
 */
export function diffFindings(
  currentIssues: HealthIssueRow[],
  previousIssues: HealthIssueRow[],
): {
  fixed: IssueTypeSummary[];
  remaining: IssueTypeSummary[];
  newly: IssueTypeSummary[];
} {
  const keyOf = (issue: HealthIssueRow) =>
    `${issue.issueType}\u0000${normalizeAffectedUrl(issue.pageUrl)}`;

  const previousKeys = new Set(previousIssues.map(keyOf));
  const currentKeys = new Set(currentIssues.map(keyOf));

  const fixed = previousIssues
    .filter((issue) => !currentKeys.has(keyOf(issue)))
    .map((issue) => ({ issueType: issue.issueType, url: issue.pageUrl }));
  const remaining = previousIssues
    .filter((issue) => currentKeys.has(keyOf(issue)))
    .map((issue) => ({ issueType: issue.issueType, url: issue.pageUrl }));
  const newly = currentIssues
    .filter((issue) => !previousKeys.has(keyOf(issue)))
    .map((issue) => ({ issueType: issue.issueType, url: issue.pageUrl }));

  return {
    fixed: summaryOf(fixed),
    remaining: summaryOf(remaining),
    newly: summaryOf(newly),
  };
}

/**
 * Surface crawl-scope differences between two audits explicitly instead of
 * silently diffing different-sized crawls. A materially wider (or narrower)
 * crawl makes "new" findings mean "seen for the first time by a bigger crawl"
 * rather than "an actual regression", so the caller labels the comparison.
 */
export function compareAuditScope(
  previous: ScopeInfo,
  current: ScopeInfo,
): { changed: boolean; note?: string } {
  const pageLimitRatio = [previous.maxPages, current.maxPages].sort(
    (a, b) => a - b,
  );
  const pagesRatio = [previous.pagesCrawled, current.pagesCrawled].sort(
    (a, b) => a - b,
  );

  const notes: string[] = [];
  if (pageLimitRatio[1] > pageLimitRatio[0] * 2) {
    notes.push(
      `the audits were capped at different page limits (${pageLimitRatio[0]} vs ${pageLimitRatio[1]})`,
    );
  }
  if (pagesRatio[1] > 0 && pagesRatio[0] < pagesRatio[1] * 0.5) {
    notes.push(
      `the audits crawled different numbers of pages (${pagesRatio[0]} vs ${pagesRatio[1]})`,
    );
  }

  return {
    changed: notes.length > 0,
    note:
      notes.length > 0
        ? "The two audits covered different amounts of the site (" +
          notes.join("; ") +
          "), so new/remaining findings can reflect the wider crawl rather than a real regression."
        : undefined,
  };
}

export function buildRerunDiff(input: {
  currentIssues: HealthIssueRow[];
  previousIssues: HealthIssueRow[];
  currentScope: ScopeInfo;
  previousScope: ScopeInfo;
  sameSite: boolean;
  currentStartedAt: string;
  previousStartedAt: string;
}): RerunDiff {
  const scope = compareAuditScope(input.previousScope, input.currentScope);
  return {
    comparable: true,
    sameSite: input.sameSite,
    scopeChanged: scope.changed,
    scopeNote: scope.note,
    previous: {
      startedAt: input.previousStartedAt,
      pagesCrawled: input.previousScope.pagesCrawled,
      maxPages: input.previousScope.maxPages,
    },
    current: {
      startedAt: input.currentStartedAt,
      pagesCrawled: input.currentScope.pagesCrawled,
      maxPages: input.currentScope.maxPages,
    },
    ...diffFindings(input.currentIssues, input.previousIssues),
  };
}

export function buildRerunDiffUnavailable(
  reason: "no-previous" | "different-site" | "incomplete",
): RerunDiff {
  return {
    comparable: false,
    reason,
    sameSite: reason === "different-site" ? false : undefined,
    previous: null,
    current: null,
    fixed: [],
    remaining: [],
    newly: [],
  };
}
