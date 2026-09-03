import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefOpportunities } from "@/db/schema";
import type { TrendbriefOpportunityStatus, TrendbriefRelevanceStatus } from "../domain/types";

export type TrendbriefOpportunity = typeof trendbriefOpportunities.$inferSelect;

export type DetectionUpsertInput = {
  organizationId: string;
  projectId: string;
  detectorId: string;
  detectorVersion: string;
  type: "improve_existing_page";
  subjectUrl: string;
  subjectQuery: string;
  impactScore: number;
  effortScore: number;
  confidenceScore: number;
  priorityScore: number;
  rationaleCodes: string[];
  relevanceStatus: TrendbriefRelevanceStatus;
  expiresAt: string;
  dedupeKey: string;
};

async function getByDedupeKey(dedupeKey: string): Promise<TrendbriefOpportunity | null> {
  const rows = await db
    .select()
    .from(trendbriefOpportunities)
    .where(eq(trendbriefOpportunities.dedupeKey, dedupeKey))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertFromDetection(
  input: DetectionUpsertInput,
): Promise<{ opportunity: TrendbriefOpportunity; wasNew: boolean }> {
  const existing = await getByDedupeKey(input.dedupeKey);
  const nowIso = new Date().toISOString();

  if (!existing) {
    const [row] = await db
      .insert(trendbriefOpportunities)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        detectorId: input.detectorId,
        detectorVersion: input.detectorVersion,
        type: input.type,
        subjectUrl: input.subjectUrl,
        subjectQuery: input.subjectQuery,
        status: "detected",
        impactScore: input.impactScore,
        effortScore: input.effortScore,
        confidenceScore: input.confidenceScore,
        priorityScore: input.priorityScore,
        rationaleCodes: JSON.stringify(input.rationaleCodes),
        relevanceStatus: input.relevanceStatus,
        firstDetectedAt: nowIso,
        lastDetectedAt: nowIso,
        expiresAt: input.expiresAt,
        dedupeKey: input.dedupeKey,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();
    if (!row) throw new Error("Failed to insert trendbrief_opportunity");
    return { opportunity: row, wasNew: true };
  }

  const [row] = await db
    .update(trendbriefOpportunities)
    .set({
      impactScore: input.impactScore,
      effortScore: input.effortScore,
      confidenceScore: input.confidenceScore,
      priorityScore: input.priorityScore,
      rationaleCodes: JSON.stringify(input.rationaleCodes),
      relevanceStatus: input.relevanceStatus,
      lastDetectedAt: nowIso,
      expiresAt: input.expiresAt,
      status: existing.status,
      updatedAt: nowIso,
    })
    .where(eq(trendbriefOpportunities.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update trendbrief_opportunity");
  return { opportunity: row, wasNew: false };
}

async function getForProject(
  projectId: string,
  opportunityId: string,
): Promise<TrendbriefOpportunity | null> {
  const rows = await db
    .select()
    .from(trendbriefOpportunities)
    .where(
      and(
        eq(trendbriefOpportunities.id, opportunityId),
        eq(trendbriefOpportunities.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listForProject(projectId: string): Promise<TrendbriefOpportunity[]> {
  return db
    .select()
    .from(trendbriefOpportunities)
    .where(eq(trendbriefOpportunities.projectId, projectId))
    .orderBy(desc(trendbriefOpportunities.priorityScore));
}

async function updateStatus(
  opportunityId: string,
  projectId: string,
  status: TrendbriefOpportunityStatus,
): Promise<TrendbriefOpportunity | null> {
  const [row] = await db
    .update(trendbriefOpportunities)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(trendbriefOpportunities.id, opportunityId),
        eq(trendbriefOpportunities.projectId, projectId),
      ),
    )
    .returning();
  return row ?? null;
}

export const TrendbriefOpportunityRepository = {
  upsertFromDetection,
  getForProject,
  listForProject,
  updateStatus,
};
