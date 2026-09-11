/**
 * Previous-audit lookup for the re-run comparison.
 *
 * Kept separate from AuditRepository so the main repository file stays under
 * the size limit; mirrors auditSummaryQueries.ts.
 * Project-scoped end to end: the current audit must belong to the project,
 * and every candidate previous audit is constrained to the same project, so no
 * other tenant's audits can ever surface as a comparison baseline.
 *
 * Site identity: two audits target the same site when their start URLs share a
 * canonical site identity (https-forced, www-stripped, case-folded origin —
 * canonicalSiteIdentity in server/lib/audit/url-utils.ts, the same rule the
 * audit's own start-URL redirect resolution ends on). Selection walks the
 * project's completed audits from newest to oldest and picks the first one for
 * the same site, so an intervening audit of a different site does not hide the
 * previous audit of this one.
 */
import { and, desc, eq, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { audits } from "@/db/schema";
import { canonicalSiteIdentity } from "@/server/lib/audit/url-utils";

// Candidates are walked newest-to-oldest in bounded pages. Paging (instead of
// an arbitrary cap on the candidate window) keeps a genuinely older previous
// audit of the same site findable on busy projects; the page bound only guards
// a pathological history.
const CANDIDATE_PAGE_SIZE = 200;
const MAX_CANDIDATE_PAGES = 50;

/**
 * The most recently *completed* prior audit for the same project and the same
 * canonical site identity. Returns null when there is no such audit.
 */
export async function getPreviousCompletedAuditForProject(
  auditId: string,
  projectId: string,
) {
  const current = await db.query.audits.findFirst({
    where: and(eq(audits.id, auditId), eq(audits.projectId, projectId)),
    columns: { startedAt: true, id: true, startUrl: true },
  });
  if (!current) return null;

  const where = and(
    eq(audits.projectId, projectId),
    eq(audits.status, "completed"),
    // startedAt is ISO-8601 text; lexical ordering matches chronological
    // ordering when zero-padded, which the app's writers always produce.
    lte(audits.startedAt, current.startedAt),
    ne(audits.id, auditId),
  );

  const siteIdentity = canonicalSiteIdentity(current.startUrl);
  for (
    let offset = 0;
    offset < MAX_CANDIDATE_PAGES * CANDIDATE_PAGE_SIZE;
    offset += CANDIDATE_PAGE_SIZE
  ) {
    const candidates = await db.query.audits.findMany({
      where,
      orderBy: desc(audits.startedAt),
      limit: CANDIDATE_PAGE_SIZE,
      offset,
    });
    if (candidates.length === 0) break;
    const match = candidates.find(
      (candidate) => canonicalSiteIdentity(candidate.startUrl) === siteIdentity,
    );
    if (match) return match;
  }
  return null;
}
