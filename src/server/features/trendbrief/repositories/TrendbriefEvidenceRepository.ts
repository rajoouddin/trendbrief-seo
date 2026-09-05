import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefEvidence } from "@/db/schema";
import { computeLegacyEvidenceDedupeKey } from "../domain/dedupeKeys";
import type {
  GscEvidenceMetrics,
  TrendbriefEvidenceSource,
  TrendbriefEvidenceType,
} from "../domain/types";

export type TrendbriefEvidence = typeof trendbriefEvidence.$inferSelect;

async function upsert(input: {
  organizationId: string;
  projectId: string;
  source: TrendbriefEvidenceSource;
  evidenceType: TrendbriefEvidenceType;
  subjectUrl: string;
  subjectQuery: string | null;
  observationStart: string;
  observationEnd: string;
  dataState: "all" | "final";
  metrics: GscEvidenceMetrics;
  dedupeKey: string;
}): Promise<TrendbriefEvidence> {
  const nowIso = new Date().toISOString();
  const subjectQueryCondition =
    input.subjectQuery === null || input.subjectQuery === ""
      ? or(
          isNull(trendbriefEvidence.subjectQuery),
          eq(trendbriefEvidence.subjectQuery, ""),
        )
      : eq(trendbriefEvidence.subjectQuery, input.subjectQuery);
  const legacyKey = computeLegacyEvidenceDedupeKey(input);
  const legacyRows = await db
    .select()
    .from(trendbriefEvidence)
    .where(
      and(
        eq(trendbriefEvidence.dedupeKey, legacyKey),
        eq(trendbriefEvidence.organizationId, input.organizationId),
        eq(trendbriefEvidence.projectId, input.projectId),
        eq(trendbriefEvidence.source, input.source),
        eq(trendbriefEvidence.evidenceType, input.evidenceType),
        eq(trendbriefEvidence.subjectUrl, input.subjectUrl),
        subjectQueryCondition,
        eq(trendbriefEvidence.observationStart, input.observationStart),
        eq(trendbriefEvidence.observationEnd, input.observationEnd),
      ),
    )
    .limit(1);
  const legacyRow = legacyRows[0];
  if (legacyRow) {
    const [row] = await db
      .update(trendbriefEvidence)
      .set({
        dedupeKey: input.dedupeKey,
        metrics: JSON.stringify(input.metrics),
        dataState: input.dataState,
        capturedAt: nowIso,
      })
      .where(
        and(
          eq(trendbriefEvidence.id, legacyRow.id),
          eq(trendbriefEvidence.organizationId, input.organizationId),
          eq(trendbriefEvidence.projectId, input.projectId),
        ),
      )
      .returning();
    if (!row) throw new Error("Failed to rekey trendbrief_evidence");
    return row;
  }

  const [row] = await db
    .insert(trendbriefEvidence)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      source: input.source,
      evidenceType: input.evidenceType,
      subjectUrl: input.subjectUrl,
      subjectQuery: input.subjectQuery,
      observationStart: input.observationStart,
      observationEnd: input.observationEnd,
      dataState: input.dataState,
      metrics: JSON.stringify(input.metrics),
      dedupeKey: input.dedupeKey,
      capturedAt: nowIso,
      createdAt: nowIso,
    })
    .onConflictDoUpdate({
      target: trendbriefEvidence.dedupeKey,
      set: {
        metrics: JSON.stringify(input.metrics),
        dataState: input.dataState,
        capturedAt: nowIso,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert trendbrief_evidence");
  return row;
}

async function listByIds(ids: string[]): Promise<TrendbriefEvidence[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(trendbriefEvidence)
    .where(inArray(trendbriefEvidence.id, ids));
}

export const TrendbriefEvidenceRepository = { upsert, listByIds };
