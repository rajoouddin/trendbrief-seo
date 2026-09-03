// Detection thresholds — the "striking distance" window. Matches the range
// already used by the existing SearchOpportunityService prototype
// (src/server/features/ga4/services/SearchOpportunityService.ts:163), reused
// here as an explicit, independently-named constant rather than an inline
// literal, per TB-001 scope: these are a starting default, not immutable
// product truth.
export const STRIKING_DISTANCE_MIN_POSITION = 4;
export const STRIKING_DISTANCE_MAX_POSITION = 20;

// A page/query with fewer impressions than this over the observation window
// is evidence, but not (yet) a meaningful opportunity signal on its own.
export const MIN_MEANINGFUL_IMPRESSIONS = 50;

// CTR below this is flagged with the "low_or_moderate_ctr" rationale code —
// a simple, named heuristic threshold, not a benchmarked industry figure.
export const LOW_CTR_THRESHOLD = 0.03;

// Confidence: how impressions map to a 0-1 sample-size component, and how
// evidence age maps to a 0-1 freshness component.
export const SAMPLE_SIZE_CONFIDENCE_CEILING = 500;
export const EVIDENCE_FRESHNESS_FULL_CONFIDENCE_DAYS = 5;
export const EVIDENCE_FRESHNESS_ZERO_CONFIDENCE_DAYS = 30;

export const CONFIDENCE_WEIGHT_FRESHNESS = 0.3;
export const CONFIDENCE_WEIGHT_SAMPLE_SIZE = 0.3;
export const CONFIDENCE_WEIGHT_RELEVANCE = 0.3;
export const CONFIDENCE_WEIGHT_AGREEMENT = 0.1;

export const CONFIDENCE_HIGH_THRESHOLD = 0.7;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.4;

// A rough, undifferentiated heuristic: improving an existing indexed page is
// assumed lower-effort than producing new content. TB-001 has no per-page
// effort measurement, so every candidate gets this same constant — documented
// as a known simplification in specs/0012, not a measured value.
export const EFFORT_IMPROVE_EXISTING_PAGE = 0.2;

// An opportunity not re-detected for this many days from its last detection
// is a candidate for a future "expired" transition. TB-001 only stores
// `expiresAt`; it does not implement the automatic transition (see specs/0012
// "Deviations" — `expired`/`superseded` are modeled but unused this slice).
export const OPPORTUNITY_STALE_AFTER_DAYS = 30;

// Outcome classification: minimum position improvement (in ranking spots) to
// call a comparison window "improved" rather than "unchanged".
export const OUTCOME_IMPROVEMENT_POSITION_THRESHOLD = 1;
