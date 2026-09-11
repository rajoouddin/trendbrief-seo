/**
 * Re-run comparison for Website Health: a deterministic diff between two
 * audits' findings, keyed by (normalized affected URL, issue type, and — where
 * an issue type is per-target — its discriminator), with explicit surfacing of
 * crawl-scope and site-origin differences instead of silently comparing unlike
 * crawls.
 *
 * A previous finding is only ever classified FIXED when the later audit has
 * positively re-evaluated the affected subject with issue-type-appropriate
 * evidence (see verification.ts for the per-type rules) and the finding is no
 * longer present. When that evidence is missing — the URL was not recrawled, a
 * peer or hop was omitted, a link target was not re-checked, or the issue type
 * is unknown to the verification model — the finding goes to Unverified, never
 * Fixed: absence of a row for a subject the crawl missed is absence of
 * evidence, not evidence of a fix.
 */
import { getIssueDescriptor } from "@/shared/audit-issues";
import { normalizeAffectedUrl } from "@/shared/audit-health/identifiers";
import {
  isPositivelyResolved,
  parseIssueDetails,
  verificationRequirement,
  wasPageEvaluated,
} from "@/shared/audit-health/verification";
import { sort } from "remeda";
import type {
  HealthIssueRow,
  HealthPageRow,
  IssueTypeSummary,
  RerunDiff,
  ScopeInfo,
} from "@/shared/audit-health/types";

export {
  verificationRequirement,
  wasPageEvaluated,
} from "@/shared/audit-health/verification";

interface IssueIdentity {
  issueType: string;
  url: string;
}

/**
 * Deterministic identity for one finding row.
 *
 * Issue type + normalized affected URL is the base identity. Issue types that
 * legitimately produce multiple rows for the same page append a discriminator
 * from their structured details:
 *
 * - broken-internal-link: the normalized link target. Page /a linking to a
 *   broken /old and later to a broken /new are different findings.
 *
 * Other issue types are per-page singular by construction (one canonical
 * conflict, one redirect chain/loop, one heading-order state, ... per page),
 * so the base identity is sufficient for them.
 *
 * Normalization never equates http/https or www/non-www variants and preserves
 * trailing slashes: two URL strings that differ in scheme, www prefix, or
 * trailing slash are distinct identities. This is deliberate — without
 * positive redirect/canonical evidence from the crawl, silently merging those
 * would call unrelated resources "the same finding". Query parameter order and
 * fragments do normalize (matching the crawler's own URL normalization).
 */
export function issueIdentityKey(issue: HealthIssueRow): string {
  const base = `${issue.issueType}\u0000${normalizeAffectedUrl(issue.pageUrl)}`;
  if (issue.issueType === "broken-internal-link") {
    const target = parseIssueDetails(issue.detailsJson).targetUrl;
    if (typeof target === "string" && target.length > 0) {
      return `${base}\u0000${normalizeAffectedUrl(target)}`;
    }
  }
  return base;
}

/**
 * Collect the current audit's page coverage keyed by normalized URL. Only
 * pages with a positive fetch result count as re-evaluated: a page the crawl
 * could not resolve (fetch error) or that was bot-blocked (WAF challenge) was
 * not evaluated, so its findings cannot be declared fixed.
 */
function buildCoverage(pages: HealthPageRow[]): Map<string, HealthPageRow> {
  const coverage = new Map<string, HealthPageRow>();
  for (const page of pages) {
    coverage.set(page.url, page);
    const normalized = normalizeAffectedUrl(page.url);
    if (!coverage.has(normalized)) coverage.set(normalized, page);
  }
  return coverage;
}

function summaryOf(
  identities: { issueType: string; url: string }[],
): IssueTypeSummary[] {
  const byType = new Map<string, { issueType: string; url: string }[]>();
  for (const identity of identities) {
    const list = byType.get(identity.issueType) ?? [];
    list.push(identity);
    byType.set(identity.issueType, list);
  }
  return sort(
    Array.from(byType.entries()).map(([issueType, rows]) => ({
      issueType,
      title: getIssueDescriptor(issueType)?.title ?? issueType,
      affected: rows.length,
      sampleUrls: rows.slice(0, 3).map((row) => row.url),
    })),
    (a, b) => b.affected - a.affected,
  );
}

/**
 * Deterministic diff between the current audit's findings and the previous
 * audit's. Fixed/Remaining/New/Unverified breakdowns are derived from
 * deduplicated identity keys, so duplicated persisted rows never inflate the
 * counts.
 *
 * `currentPages` is required: without the current audit's page coverage there
 * is no way to know which previous findings were actually re-evaluated, and
 * absence-of-row could not be distinguished from absence-of-evidence.
 */
export function diffFindings(
  currentIssues: HealthIssueRow[],
  previousIssues: HealthIssueRow[],
  currentPages: HealthPageRow[],
): {
  fixed: IssueTypeSummary[];
  remaining: IssueTypeSummary[];
  newly: IssueTypeSummary[];
  unverified: IssueTypeSummary[];
} {
  const keyOf = issueIdentityKey;

  const currentKeys = new Set(currentIssues.map(keyOf));
  const previousKeys = new Set(previousIssues.map(keyOf));
  const previousByKey = new Map<string, HealthIssueRow>();
  for (const issue of previousIssues) previousByKey.set(keyOf(issue), issue);
  const currentByKey = new Map<string, HealthIssueRow>();
  for (const issue of currentIssues) currentByKey.set(keyOf(issue), issue);

  const coverage = buildCoverage(currentPages);

  const fixed: IssueIdentity[] = [];
  const remaining: IssueIdentity[] = [];
  const unverified: IssueIdentity[] = [];
  for (const key of previousKeys) {
    const previous = previousByKey.get(key)!;
    if (currentKeys.has(key)) {
      remaining.push({ issueType: previous.issueType, url: previous.pageUrl });
    } else if (isPositivelyResolved(previous, coverage)) {
      fixed.push({ issueType: previous.issueType, url: previous.pageUrl });
    } else {
      unverified.push({ issueType: previous.issueType, url: previous.pageUrl });
    }
  }

  const newly: IssueIdentity[] = [];
  for (const key of currentKeys) {
    if (previousKeys.has(key)) continue;
    const issue = currentByKey.get(key)!;
    newly.push({ issueType: issue.issueType, url: issue.pageUrl });
  }

  return {
    fixed: summaryOf(fixed),
    remaining: summaryOf(remaining),
    newly: summaryOf(newly),
    unverified: summaryOf(unverified),
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
  const pageLimitRatio = sort(
    [previous.maxPages, current.maxPages],
    (a, b) => a - b,
  );
  const pagesRatio = sort(
    [previous.pagesCrawled, current.pagesCrawled],
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

interface OriginMigrationInfo {
  changed: boolean;
  previousOrigin: string;
  currentOrigin: string;
  note?: string;
}

/**
 * Detect an HTTP/HTTPS or www/non-www origin migration between two audits'
 * start URLs. The caller has already established the audits are the same site
 * under canonicalSiteIdentity (scheme- and www-insensitive); this reports when
 * their concrete origins still differ in scheme, host form, or port. When it
 * fires, findings on URLs that changed scheme or host are legitimately New or
 * Unverified (finding identities are URL-exact), and must never be silently
 * called Fixed because of the migration.
 */
export function compareOrigins(
  previousStartUrl: string,
  currentStartUrl: string,
): OriginMigrationInfo | null {
  let previous: URL;
  let current: URL;
  try {
    previous = new URL(previousStartUrl);
    current = new URL(currentStartUrl);
  } catch {
    return null;
  }
  const previousOrigin = previous.origin;
  const currentOrigin = current.origin;
  if (previousOrigin === currentOrigin) {
    return { changed: false, previousOrigin, currentOrigin };
  }
  const note =
    "This rerun uses a different site origin from the previous audit (for " +
    "example HTTP→HTTPS or www→non-www). Some findings may appear as New or " +
    "Unverified because URLs changed.";
  return { changed: true, previousOrigin, currentOrigin, note };
}

export function buildRerunDiff(input: {
  currentIssues: HealthIssueRow[];
  previousIssues: HealthIssueRow[];
  currentPages: HealthPageRow[];
  currentScope: ScopeInfo;
  previousScope: ScopeInfo;
  sameSite: boolean;
  currentStartedAt: string;
  previousStartedAt: string;
  currentStartUrl: string;
  previousStartUrl: string;
}): RerunDiff {
  const scope = compareAuditScope(input.previousScope, input.currentScope);
  const origin = compareOrigins(input.previousStartUrl, input.currentStartUrl);
  return {
    comparable: true,
    sameSite: input.sameSite,
    scopeChanged: scope.changed,
    scopeNote: scope.note,
    originChanged: origin ?? {
      changed: false,
      previousOrigin: "",
      currentOrigin: "",
    },
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
    ...diffFindings(
      input.currentIssues,
      input.previousIssues,
      input.currentPages,
    ),
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
    unverified: [],
  };
}
