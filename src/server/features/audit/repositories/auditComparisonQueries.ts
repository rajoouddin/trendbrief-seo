/**
 * Previous-audit lookup for the re-run comparison.
 *
 * Kept separate from AuditRepository so the main repository file stays under
 * the size limit; mirrors auditSummaryQueries.ts.
 * Project-scoped end to end: the current audit must belong to the project,
 * and the returned previous audit is constrained to the same project, so no
 * other tenant's audits can ever surface as a comparison baseline.
 */
import { and, desc, eq, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { audits } from "@/db/schema";

/**
 * The most recently *completed* audit for the same project that started
 * before this one. Returns null when there is no such audit.
 */
export async function getPreviousCompletedAuditForProject(
  auditId: string,
  projectId: string,
) {
  const current = await db.query.audits.findFirst({
    where: and(eq(audits.id, auditId), eq(audits.projectId, projectId)),
    columns: { startedAt: true, id: true },
  });
  if (!current) return null;

  return db.query.audits.findFirst({
    where: and(
      eq(audits.projectId, projectId),
      eq(audits.status, "completed"),
      // startedAt is ISO-8601 text; lexical ordering matches chronological
      // ordering when zero-padded, which the app's writers always produce.
      lte(audits.startedAt, current.startedAt),
      ne(audits.id, auditId),
    ),
    orderBy: desc(audits.startedAt),
  });
}
