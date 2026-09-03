import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefRecommendations } from "@/db/schema";

export type TrendbriefRecommendation =
  typeof trendbriefRecommendations.$inferSelect;

export type ProposedAction = {
  page: string;
  reasonCodes: string[];
  suggestedNextAnalysis: string[];
};

async function getByOpportunityId(
  opportunityId: string,
): Promise<TrendbriefRecommendation | null> {
  const rows = await db
    .select()
    .from(trendbriefRecommendations)
    .where(eq(trendbriefRecommendations.opportunityId, opportunityId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertForOpportunity(input: {
  opportunityId: string;
  organizationId: string;
  projectId: string;
  recommendationType: "improve_existing_page";
  proposedAction: ProposedAction;
  groundedSummary: string;
}): Promise<TrendbriefRecommendation> {
  const existing = await getByOpportunityId(input.opportunityId);
  const nowIso = new Date().toISOString();

  if (!existing) {
    const [row] = await db
      .insert(trendbriefRecommendations)
      .values({
        id: crypto.randomUUID(),
        opportunityId: input.opportunityId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        version: 1,
        recommendationType: input.recommendationType,
        generationMethod: "deterministic",
        proposedAction: JSON.stringify(input.proposedAction),
        groundedSummary: input.groundedSummary,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();
    if (!row) throw new Error("Failed to insert trendbrief_recommendation");
    return row;
  }

  const [row] = await db
    .update(trendbriefRecommendations)
    .set({
      version: existing.version + 1,
      proposedAction: JSON.stringify(input.proposedAction),
      groundedSummary: input.groundedSummary,
      updatedAt: nowIso,
    })
    .where(eq(trendbriefRecommendations.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update trendbrief_recommendation");
  return row;
}

export const TrendbriefRecommendationRepository = {
  upsertForOpportunity,
  getByOpportunityId,
};
