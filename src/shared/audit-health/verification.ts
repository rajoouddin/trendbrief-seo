/**
 * Issue-aware re-run verification model for Website Health.
 *
 * Each issue type declares how a disappeared finding can be positively
 * re-verified. The default is "unsupported": unknown or legacy types are never
 * promoted to Fixed on absence alone. This keeps verification behaviour
 * deterministic and reviewable in one place instead of scattered conditions,
 * and lets compare.ts stay focused on the diff itself.
 *
 * Verification result semantics: the functions here answer "is this previous
 * finding positively resolved by the current audit's data?" — true => Fixed,
 * false => Unverified. Remaining is decided by finding presence in the current
 * audit (see diffFindings).
 */
import { normalizeAffectedUrl } from "@/shared/audit-health/identifiers";
import type {
  HealthIssueRow,
  HealthPageRow,
} from "@/shared/audit-health/types";

type VerificationRequirement =
  /** Re-evaluating the affected page itself is sufficient. */
  | "page"
  /** A specific linked target must be re-evaluated as healthy. */
  | "brokenTarget"
  /** The duplicate group must be recomputable from current page data. */
  | "duplicateGroup"
  /** The redirect path must be reconstructable and resolved. */
  | "redirectPath"
  /** The internal-link graph is required; not verifiable from persisted data. */
  | "linkGraph"
  /** Sitemap membership must be positively re-evaluated. */
  | "sitemapConflict"
  /** Unknown/unverifiable — never Fixed. */
  | "unsupported";

/**
 * Page-local issue types: the finding is fully determined by the affected page
 * itself, so a successful re-evaluation plus the finding's absence is positive
 * evidence the issue is gone. Mirrors the per-page reporters in
 * server/lib/audit/issues/page-reporters.ts (no page of these types depends on
 * another page, a link target, a group membership, or a redirect path).
 */
const PAGE_LOCAL_ISSUE_TYPES: ReadonlySet<string> = new Set([
  "blocked-page",
  "server-error",
  "broken-page",
  "missing-title",
  "title-too-long",
  "title-too-short",
  "missing-meta-description",
  "meta-description-too-long",
  "meta-description-too-short",
  "missing-h1",
  "multiple-h1",
  "heading-order-skip",
  "noindex-page",
  "canonical-conflict",
  "canonicalized-page",
  "thin-content",
  "images-missing-alt",
  "no-outgoing-links",
  "slow-response",
]);

const DUPLICATE_ISSUE_TYPES: ReadonlySet<string> = new Set([
  "duplicate-title",
  "duplicate-meta-description",
  "duplicate-content",
]);

/** Issue types whose condition lives in the crawl's internal-link graph. */
const LINK_GRAPH_ISSUE_TYPES: ReadonlySet<string> = new Set([
  "orphan-page",
  "deep-page",
]);

export function verificationRequirement(
  issueType: string,
): VerificationRequirement {
  if (PAGE_LOCAL_ISSUE_TYPES.has(issueType)) return "page";
  if (issueType === "broken-internal-link") return "brokenTarget";
  if (DUPLICATE_ISSUE_TYPES.has(issueType)) return "duplicateGroup";
  if (issueType === "redirect-chain" || issueType === "redirect-loop") {
    return "redirectPath";
  }
  if (issueType === "sitemap-noindex-conflict") return "sitemapConflict";
  if (LINK_GRAPH_ISSUE_TYPES.has(issueType)) return "linkGraph";
  return "unsupported";
}

export function parseIssueDetails(
  detailsJson: string | null | undefined,
): Record<string, unknown> {
  if (!detailsJson) return {};
  try {
    const value: unknown = JSON.parse(detailsJson);
    if (!!value && typeof value === "object" && !Array.isArray(value)) {
      const result: Record<string, unknown> = {};
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

/**
 * Positive re-evaluation evidence for one page row: the crawl reached the URL
 * with a fetchClass of "ok" (not bot-blocked, not a fetch error) and the page
 * responded with a live 2xx/3xx status (an evaluated redirect counts — it was
 * still resolved). A page that now returns 4xx/5xx is *not* positive evidence:
 * its findings may have disappeared because the page died rather than because
 * the underlying issue was fixed, so those findings must not become Fixed.
 */
export function wasPageEvaluated(page: HealthPageRow | undefined): boolean {
  if (!page) return false;
  if (page.fetchClass !== undefined && page.fetchClass !== null) {
    if (page.fetchClass !== "ok") return false;
  }
  const code = page.statusCode;
  return code !== null && code >= 100 && code < 400;
}

/**
 * A previous finding is positively resolved when the current audit carries
 * issue-type-appropriate evidence that the condition is gone. The affected
 * page must always have been re-evaluated; each verification class then adds
 * its own requirement:
 *
 * - page-local: the page re-evaluation is the whole story.
 * - brokenTarget: a valid target detail plus that target re-evaluated healthy.
 * - duplicateGroup: the duplicate group recomputed and dissolved.
 * - redirectPath: the current redirect path reconstructed and resolved.
 * - sitemapConflict: the page became indexable (positive, page-level proof).
 * - linkGraph / unsupported: no positive evidence available -> Unverified.
 *
 * Unsure re-evaluations (page, target, peer, or hop missing from the current
 * crawl, blocked, or still failing) return false.
 */
export function isPositivelyResolved(
  issue: HealthIssueRow,
  coverage: Map<string, HealthPageRow>,
): boolean {
  const page = coverage.get(normalizeAffectedUrl(issue.pageUrl));
  if (!wasPageEvaluated(page)) return false;

  switch (verificationRequirement(issue.issueType)) {
    case "page":
      return true;
    case "brokenTarget":
      return isBrokenTargetResolved(issue, coverage);
    case "duplicateGroup":
      return isDuplicateGroupResolved(issue, coverage);
    case "redirectPath":
      return isRedirectPathResolved(issue, coverage);
    case "sitemapConflict":
      return isSitemapNoindexConflictResolved(issue, coverage);
    case "linkGraph":
      // Orphanhood (and graph-derived depth) depends on the internal-link
      // graph, which this feature does not persist. Absence of an orphan row
      // can mean a fix, a suppressed check, or a truncated crawl — so a
      // disappeared orphan finding is never called Fixed.
      return false;
    case "unsupported":
      // Unknown/legacy issue types: no verification rule, so no Fixed.
      return false;
  }
}

/**
 * Sitemap/noindex-conflict positive verification.
 *
 * The finding requires BOTH a non-indexable page AND positive sitemap
 * membership, so it cannot be considered page-local: a disappeared row can
 * mean the page became indexable, OR the sitemap discovery failed or was
 * truncated this run and inSitemap silently fell back to false.
 *
 * The only reliable positive evidence available in persisted data is the page
 * itself becoming indexable: the conflict (which requires a non-indexable
 * page) then cannot exist, regardless of sitemap evidence. A still-noindex
 * page can never be proven absent from a successfully evaluated sitemap from
 * the comparison model's data, so that case stays Unverified rather than
 * being inferred Fixed from finding absence.
 */
function isSitemapNoindexConflictResolved(
  issue: HealthIssueRow,
  coverage: Map<string, HealthPageRow>,
): boolean {
  const page = coverage.get(normalizeAffectedUrl(issue.pageUrl));
  if (!page || !wasPageEvaluated(page)) return false;
  if (page.isIndexable) return true;
  return false;
}

/**
 * Broken-link positive verification requires a valid structured target and
 * that target's positive re-evaluation. A re-evaluated, healthy (sub-4xx)
 * target resolves the finding; a missing, malformed, blocked, still-failing, or
 * unrecorded target does not. The source page's fetch alone is never
 * sufficient.
 */
function isBrokenTargetResolved(
  issue: HealthIssueRow,
  coverage: Map<string, HealthPageRow>,
): boolean {
  const target = parseIssueDetails(issue.detailsJson).targetUrl;
  if (typeof target !== "string" || target.length === 0) return false;
  const targetPage = coverage.get(normalizeAffectedUrl(target));
  if (!targetPage || !wasPageEvaluated(targetPage)) return false;
  const code = targetPage.statusCode;
  return code !== null && code < 400;
}

/**
 * Duplicate-group verification: recompute the duplicate relationship for the
 * affected page from the current audit's own page data. A disappeared
 * duplicate finding is only Fixed when the affected page was re-evaluated and
 * we can prove the group is gone — every known group member must have been
 * re-evaluated, the group's recorded size must be fully accounted for, and no
 * surviving member may still share the duplicated attribute. Anything less
 * (omitted peer, blocked peer, sampled-but-unaccounted members, or a legacy row
 * without group provenance) stays Unverified.
 */
function isDuplicateGroupResolved(
  issue: HealthIssueRow,
  coverage: Map<string, HealthPageRow>,
): boolean {
  const details = parseIssueDetails(issue.detailsJson);
  const groupSize =
    typeof details.groupSize === "number" ? details.groupSize : null;
  const peerUrls = hopList(details.otherUrls);
  // Legacy rows without group provenance cannot be positively verified.
  if (groupSize === null && peerUrls.length === 0) return false;

  const affected = coverage.get(normalizeAffectedUrl(issue.pageUrl));
  if (!affected || !wasPageEvaluated(affected)) return false;

  const attr = duplicateAttribute(issue.issueType);
  if (attr === null) return false;

  // The page no longer carries the duplicated attribute (cleared, empty, or —
  // for content — rendered wordless), so it cannot be a duplicate member.
  if (attr === "contentHash") {
    if ((affected.wordCount ?? 0) === 0) return true;
  } else if (affected[attr] == null || affected[attr] === "") {
    return true;
  }

  const currentValue = affected[attr];
  if (currentValue == null || currentValue === "") return false;

  // Every known peer must have been positively re-evaluated.
  const peerByUrl = new Map<string, HealthPageRow>();
  for (const page of uniquePages(coverage)) {
    peerByUrl.set(normalizeAffectedUrl(page.url), page);
  }
  for (const peerUrl of peerUrls) {
    const peer = peerByUrl.get(normalizeAffectedUrl(peerUrl));
    if (!peer || !wasPageEvaluated(peer)) return false;
    if (sharesDuplicateValue(peer, attr, currentValue)) return false;
  }

  // Recompute across the whole current page set: any surviving candidate that
  // still shares the attribute is a live duplicate.
  for (const page of uniquePages(coverage)) {
    if (page === affected) continue;
    if (
      isDuplicateCandidate(page) &&
      sharesDuplicateValue(page, attr, currentValue)
    ) {
      return false;
    }
  }

  // If the recorded group had more members than we can enumerate, an unseen
  // member might simply have been missed by the current crawl — the comparison
  // set is incomplete, so the group cannot be proven dissolved.
  const knownMembers = peerUrls.length + 1;
  if (groupSize !== null && groupSize !== knownMembers) return false;

  return true;
}

function duplicateAttribute(
  issueType: string,
): "title" | "metaDescription" | "contentHash" | null {
  if (issueType === "duplicate-title") return "title";
  if (issueType === "duplicate-meta-description") return "metaDescription";
  if (issueType === "duplicate-content") return "contentHash";
  return null;
}

function sharesDuplicateValue(
  page: HealthPageRow,
  attr: "title" | "metaDescription" | "contentHash",
  value: string,
): boolean {
  const candidateValue = page[attr];
  if (candidateValue == null || candidateValue === "") return false;
  if (attr === "contentHash") {
    return (page.wordCount ?? 0) > 0 && candidateValue === value;
  }
  return candidateValue === value;
}

/**
 * Whether a page would be eligible for a duplicate group: a positively
 * evaluated indexable page that does not canonicalize itself away. Mirrors
 * isDuplicateCandidate in server/lib/audit/issues/multipage-checks.ts, using
 * the page-row fields the comparison model carries.
 */
function isDuplicateCandidate(page: HealthPageRow): boolean {
  if (!wasPageEvaluated(page) || !page.isIndexable) return false;
  const effectiveCanonical = page.canonicalUrl ?? page.headerCanonicalUrl;
  return !effectiveCanonical || effectiveCanonical === page.url;
}

/**
 * Redirect-chain/loop verification reconstructs the affected URL's redirect
 * path from the current audit's page rows. Every hop must be present and
 * positively evaluated; a loop resolves only when the current path terminates,
 * and a chain only when it has shortened to at most one redirect. Legacy rows
 * without a recorded redirect path, or any path whose downstream hops were not
 * observed, cannot be verified.
 */
function isRedirectPathResolved(
  issue: HealthIssueRow,
  coverage: Map<string, HealthPageRow>,
): boolean {
  const previousHops = hopList(parseIssueDetails(issue.detailsJson).hops);
  if (previousHops.length === 0) return false;

  let redirectCount = 0;
  const seen = new Set<string>();
  let current: string | null = normalizeAffectedUrl(issue.pageUrl);
  while (current !== null) {
    if (seen.has(current)) return false;
    seen.add(current);
    const page = coverage.get(current);
    if (!page || !wasPageEvaluated(page)) return false;
    const code = page.statusCode;
    if (code === null) return false;
    if (code >= 300 && code < 400) {
      const target = page.redirectUrl;
      if (typeof target !== "string" || target.length === 0) return false;
      redirectCount += 1;
      current = normalizeAffectedUrl(target);
      continue;
    }
    break;
  }

  if (issue.issueType === "redirect-loop") return true;
  return redirectCount <= 1;
}

function hopList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function uniquePages(coverage: Map<string, HealthPageRow>): HealthPageRow[] {
  return Array.from(new Set(coverage.values()));
}
