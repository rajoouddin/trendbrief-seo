import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefEvidence, trendbriefOpportunityEvidence } from "@/db/schema";
import type { TrendbriefEvidence } from "./TrendbriefEvidenceRepository";

async function linkEvidence(opportunityId: string, evidenceIds: string[]): Promise<void> {
  for (const evidenceId of evidenceIds) {
    await db
      .insert(trendbriefOpportunityEvidence)
      .values({ opportunityId, evidenceId, createdAt: new Date().toISOString() })
      .onConflictDoNothing({
        target: [trendbriefOpportunityEvidence.opportunityId, trendbriefOpportunityEvidence.evidenceId],
      });
  }
}

async function listEvidenceForOpportunity(opportunityId: string): Promise<TrendbriefEvidence[]> {
  const rows = await db
    .select({ evidence: trendbriefEvidence })
    .from(trendbriefOpportunityEvidence)
    .innerJoin(
      trendbriefEvidence,
      eq(trendbriefOpportunityEvidence.evidenceId, trendbriefEvidence.id),
    )
    .where(eq(trendbriefOpportunityEvidence.opportunityId, opportunityId));
  return rows.map((row) => row.evidence);
}

export const TrendbriefOpportunityEvidenceRepository = { linkEvidence, listEvidenceForOpportunity };
