import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { trendbriefEvidence } from "@/db/schema";
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
  return db.select().from(trendbriefEvidence).where(inArray(trendbriefEvidence.id, ids));
}

export const TrendbriefEvidenceRepository = { upsert, listByIds };
