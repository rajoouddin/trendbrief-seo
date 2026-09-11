/**
 * Shared row shapes and presentation types for the Website Health model.
 * Keep this module free of runtime dependencies so every other health module
 * can import it in both directions without a cycle.
 */
import type { IssueSeverity } from "@/shared/audit-issues";

/** Structural subset of a persisted audit_issues row. */
export interface HealthIssueRow {
  id: string;
  pageId?: string | null;
  pageUrl: string;
  issueType: string;
  severity: string;
  detailsJson?: string | null;
}

/** Structural subset of a persisted audit_pages row. */
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
  /** Internal link edges parsed from the page HTML (0/absent = none checked). */
  internalLinkCount?: number | null;
  /**
   * How the crawl resolved the fetch: ok | blocked | error. Null/absent when
   * the caller only has page rows without fetch provenance; positive
   * re-evaluation then falls back to statusCode.
   */
  fetchClass?: string | null;
}

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
  /**
   * Previous findings for URLs the current audit did not positively
   * re-evaluate (page not crawled, or crawled but not evaluable — blocked /
   * fetch error). Never classified Fixed: absence of the row when the subject
   * was not re-examined is absence of evidence, not evidence of a fix.
   */
  unverified: IssueTypeSummary[];
}

/** Parsed issue-details JSON, keyed by the issue engine's detail names. */
export type IssueDetails = Record<string, unknown>;
