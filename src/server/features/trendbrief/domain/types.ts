export const TRENDBRIEF_EVIDENCE_SOURCES = ["gsc"] as const;
export type TrendbriefEvidenceSource =
  (typeof TRENDBRIEF_EVIDENCE_SOURCES)[number];

export const TRENDBRIEF_EVIDENCE_TYPES = [
  "gsc_page_query_performance",
] as const;
export type TrendbriefEvidenceType = (typeof TRENDBRIEF_EVIDENCE_TYPES)[number];

export type GscEvidenceMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export const TRENDBRIEF_OPPORTUNITY_STATUSES = [
  "detected",
  "accepted",
  "rejected",
  "completed",
  "measuring",
  "successful",
  "inconclusive",
  "unsuccessful",
  "expired",
  "superseded",
] as const;
export type TrendbriefOpportunityStatus =
  (typeof TRENDBRIEF_OPPORTUNITY_STATUSES)[number];

export const TRENDBRIEF_RELEVANCE_STATUSES = [
  "confirmed",
  "unconfirmed",
] as const;
export type TrendbriefRelevanceStatus =
  (typeof TRENDBRIEF_RELEVANCE_STATUSES)[number];

export const TRENDBRIEF_ACTION_TYPES = [
  "accept",
  "reject",
  "complete",
] as const;
export type TrendbriefActionType = (typeof TRENDBRIEF_ACTION_TYPES)[number];

export const TRENDBRIEF_OUTCOME_CLASSIFICATIONS = [
  "improved",
  "unchanged",
  "declined",
  "inconclusive",
] as const;
export type TrendbriefOutcomeClassification =
  (typeof TRENDBRIEF_OUTCOME_CLASSIFICATIONS)[number];

// Stable detector identity — persisted on every opportunity row so a future
// scoring change can be distinguished from a past decision. Bump VERSION (not
// ID) when the detection/scoring rules change; bump ID for a genuinely new
// detector.
export const GSC_STRIKING_DISTANCE_DETECTOR_ID = "gsc-striking-distance";
export const GSC_STRIKING_DISTANCE_DETECTOR_VERSION = "v1";
export const GSC_STRIKING_DISTANCE_DETECTOR_KEY = `${GSC_STRIKING_DISTANCE_DETECTOR_ID}:${GSC_STRIKING_DISTANCE_DETECTOR_VERSION}`;
