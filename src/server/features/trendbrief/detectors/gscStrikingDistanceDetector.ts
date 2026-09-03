import type { TrendbriefRelevanceStatus, GscEvidenceMetrics } from "../domain/types";
import type { TrendbriefEvidence } from "../repositories/TrendbriefEvidenceRepository";
import { computeConfidenceScore } from "../scoring/confidence";
import {
  EFFORT_IMPROVE_EXISTING_PAGE,
  LOW_CTR_THRESHOLD,
  MIN_MEANINGFUL_IMPRESSIONS,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
} from "../scoring/constants";
import { matchCommercialRelevance, type KeyPageForRelevance } from "../scoring/relevance";
import { computeDemandScore, computePriorityScore, computeReachabilityScore } from "../scoring/score";

export type StrikingDistanceCandidate = {
  subjectUrl: string;
  subjectQuery: string;
  evidenceIds: string[];
  metrics: GscEvidenceMetrics;
  observationStart: string;
  observationEnd: string;
  relevanceStatus: TrendbriefRelevanceStatus;
  matchedKeyPageRole: string | null;
  scores: {
    demand: number;
    reachability: number;
    businessRelevance: number;
    confidence: number;
    effort: number;
    priority: number;
  };
  rationaleCodes: string[];
};

export function detectGscStrikingDistanceCandidates(input: {
  evidence: TrendbriefEvidence[];
  keyPages: KeyPageForRelevance[];
  now?: Date;
}): StrikingDistanceCandidate[] {
  const now = input.now ?? new Date();
  const candidates: StrikingDistanceCandidate[] = [];

  for (const row of input.evidence) {
    if (!row.subjectQuery) continue;
    const metrics = JSON.parse(row.metrics) as GscEvidenceMetrics;

    if (
      metrics.position < STRIKING_DISTANCE_MIN_POSITION ||
      metrics.position > STRIKING_DISTANCE_MAX_POSITION
    ) {
      continue;
    }
    if (metrics.impressions < MIN_MEANINGFUL_IMPRESSIONS) continue;

    const relevance = matchCommercialRelevance(row.subjectUrl, input.keyPages);
    const demand = computeDemandScore(metrics.impressions);
    const reachability = computeReachabilityScore(metrics.position);
    const businessRelevance = relevance.status === "confirmed" ? 1 : 0.5;
    const confidence = computeConfidenceScore(
      {
        observationEndDate: row.observationEnd,
        impressions: metrics.impressions,
        relevanceStatus: relevance.status,
        evidenceSourceCount: 1,
      },
      now,
    );
    const effort = EFFORT_IMPROVE_EXISTING_PAGE;
    const priority = computePriorityScore({ demand, reachability, businessRelevance, confidence, effort });

    const rationaleCodes = ["striking_distance", "meaningful_impressions"];
    rationaleCodes.push(metrics.ctr < LOW_CTR_THRESHOLD ? "low_or_moderate_ctr" : "healthy_ctr");
    rationaleCodes.push(
      relevance.status === "confirmed"
        ? `commercial_relevance_confirmed_${relevance.matchedRole ?? "key_page"}`
        : "relevance_unconfirmed",
    );

    candidates.push({
      subjectUrl: row.subjectUrl,
      subjectQuery: row.subjectQuery,
      evidenceIds: [row.id],
      metrics,
      observationStart: row.observationStart,
      observationEnd: row.observationEnd,
      relevanceStatus: relevance.status,
      matchedKeyPageRole: relevance.matchedRole,
      scores: { demand, reachability, businessRelevance, confidence, effort, priority },
      rationaleCodes,
    });
  }

  return candidates;
}
