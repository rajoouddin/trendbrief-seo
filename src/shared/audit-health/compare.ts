/**
 * Re-run comparison for Website Health: a deterministic diff between two
 * audits' findings, keyed by (normalized affected URL, issue type), with
 * explicit surfacing of crawl-scope differences instead of silently comparing
 * unlike crawls.
 */
import { getIssueDescriptor } from "@/shared/audit-issues";
import { normalizeAffectedUrl } from "@/shared/audit-health/identifiers";
import { sort } from "remeda";
import type {
  HealthIssueRow,
  IssueTypeSummary,
  RerunDiff,
  ScopeInfo,
} from "@/shared/audit-health/types";

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
  return sort(
    Array.from(byType.values()).map((rows) => ({
      issueType: rows[0].issueType,
      title: getIssueDescriptor(rows[0].issueType)?.title ?? rows[0].issueType,
      affected: rows.length,
      sampleUrls: rows.slice(0, 3).map((row) => row.url),
    })),
    (a, b) => b.affected - a.affected,
  );
}

/**
 * Deterministic diff between the current audit's findings and the previous
 * audit's. A grouped issue's Fixed/Remaining/New breakdown is derived from
 * these URL-level identities.
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
