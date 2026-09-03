import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { computeOpportunityDedupeKey } from "../domain/dedupeKeys";
import {
  GSC_STRIKING_DISTANCE_DETECTOR_ID,
  GSC_STRIKING_DISTANCE_DETECTOR_KEY,
  GSC_STRIKING_DISTANCE_DETECTOR_VERSION,
} from "../domain/types";
import { detectGscStrikingDistanceCandidates } from "../detectors/gscStrikingDistanceDetector";
import { TrendbriefOpportunityEvidenceRepository } from "../repositories/TrendbriefOpportunityEvidenceRepository";
import { TrendbriefOpportunityRepository } from "../repositories/TrendbriefOpportunityRepository";
import { TrendbriefRecommendationRepository } from "../repositories/TrendbriefRecommendationRepository";
import { OPPORTUNITY_STALE_AFTER_DAYS } from "../scoring/constants";
import { buildDeterministicRecommendation } from "./TrendbriefRecommendationBuilder";
import { TrendbriefEvidenceCollector } from "./TrendbriefEvidenceCollector";

export type AnalyzeProjectInput = {
  organizationId: string;
  projectId: string;
  startDate?: string;
  endDate?: string;
};

export type AnalyzeProjectResult = {
  evidenceIngested: number;
  opportunitiesDetected: number;
  opportunitiesCreated: number;
  // A re-detected candidate that already had a persisted opportunity: the
  // brief's "existing opportunities updated / duplicates skipped" outcome —
  // the row is refreshed in place, never duplicated.
  opportunitiesUpdated: number;
};

async function analyzeProject(input: AnalyzeProjectInput): Promise<AnalyzeProjectResult> {
  const [collected, keyPages] = await Promise.all([
    TrendbriefEvidenceCollector.collectGscStrikingDistanceEvidence(input),
    ProjectContextRepository.listKeyPages(input.projectId),
  ]);

  const candidates = detectGscStrikingDistanceCandidates({
    evidence: collected.evidence,
    keyPages,
  });

  let created = 0;
  let updated = 0;
  const expiresAt = new Date(
    Date.now() + OPPORTUNITY_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (const candidate of candidates) {
    const dedupeKey = computeOpportunityDedupeKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      detectorKey: GSC_STRIKING_DISTANCE_DETECTOR_KEY,
      subjectUrl: candidate.subjectUrl,
      subjectQuery: candidate.subjectQuery,
    });

    const { opportunity, wasNew } = await TrendbriefOpportunityRepository.upsertFromDetection({
      organizationId: input.organizationId,
      projectId: input.projectId,
      detectorId: GSC_STRIKING_DISTANCE_DETECTOR_ID,
      detectorVersion: GSC_STRIKING_DISTANCE_DETECTOR_VERSION,
      type: "improve_existing_page",
      subjectUrl: candidate.subjectUrl,
      subjectQuery: candidate.subjectQuery,
      impactScore: candidate.scores.demand,
      effortScore: candidate.scores.effort,
      confidenceScore: candidate.scores.confidence,
      priorityScore: candidate.scores.priority,
      rationaleCodes: candidate.rationaleCodes,
      relevanceStatus: candidate.relevanceStatus,
      expiresAt,
      dedupeKey,
    });

    await TrendbriefOpportunityEvidenceRepository.linkEvidence(
      opportunity.id,
      candidate.evidenceIds,
    );

    const recommendation = buildDeterministicRecommendation(candidate);
    await TrendbriefRecommendationRepository.upsertForOpportunity({
      opportunityId: opportunity.id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      recommendationType: "improve_existing_page",
      proposedAction: recommendation.proposedAction,
      groundedSummary: recommendation.groundedSummary,
    });

    if (wasNew) created += 1;
    else updated += 1;
  }

  return {
    evidenceIngested: collected.evidence.length,
    opportunitiesDetected: candidates.length,
    opportunitiesCreated: created,
    opportunitiesUpdated: updated,
  };
}

export const TrendbriefAnalysisService = { analyzeProject };
