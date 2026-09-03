import { GscService } from "@/server/features/gsc/services/GscService";
import { computeEvidenceDedupeKey } from "../domain/dedupeKeys";
import type { GscEvidenceMetrics } from "../domain/types";
import {
  TrendbriefEvidenceRepository,
  type TrendbriefEvidence,
} from "../repositories/TrendbriefEvidenceRepository";
import {
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
} from "../scoring/constants";

export type CollectGscEvidenceInput = {
  organizationId: string;
  projectId: string;
  startDate?: string;
  endDate?: string;
};

export type CollectedEvidenceSummary = {
  observationStart: string;
  observationEnd: string;
  rowsConsidered: number;
  rowsInStrikingDistance: number;
  evidence: TrendbriefEvidence[];
};

async function collectGscStrikingDistanceEvidence(
  input: CollectGscEvidenceInput,
): Promise<CollectedEvidenceSummary> {
  const performance = await GscService.getPerformance({
    projectId: input.projectId,
    dimensions: ["page", "query"],
    startDate: input.startDate,
    endDate: input.endDate,
    rowLimit: 1_000,
    startRow: 0,
    type: "web",
    dataState: "final",
  });

  const qualifying = performance.rows.filter(
    (row) =>
      (row.keys?.length ?? 0) >= 2 &&
      row.position >= STRIKING_DISTANCE_MIN_POSITION &&
      row.position <= STRIKING_DISTANCE_MAX_POSITION,
  );

  const evidence: TrendbriefEvidence[] = [];
  for (const row of qualifying) {
    const subjectUrl = row.keys![0];
    const subjectQuery = row.keys![1];
    const metrics: GscEvidenceMetrics = {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };
    const dedupeKey = computeEvidenceDedupeKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      source: "gsc",
      evidenceType: "gsc_page_query_performance",
      subjectUrl,
      subjectQuery,
      observationStart: performance.request.startDate,
      observationEnd: performance.request.endDate,
    });
    const row_ = await TrendbriefEvidenceRepository.upsert({
      organizationId: input.organizationId,
      projectId: input.projectId,
      source: "gsc",
      evidenceType: "gsc_page_query_performance",
      subjectUrl,
      subjectQuery,
      observationStart: performance.request.startDate,
      observationEnd: performance.request.endDate,
      dataState: "final",
      metrics,
      dedupeKey,
    });
    evidence.push(row_);
  }

  return {
    observationStart: performance.request.startDate,
    observationEnd: performance.request.endDate,
    rowsConsidered: performance.rows.length,
    rowsInStrikingDistance: qualifying.length,
    evidence,
  };
}

export const TrendbriefEvidenceCollector = { collectGscStrikingDistanceEvidence };
