import type { TrendbriefEvidenceSource, TrendbriefEvidenceType } from "./types";

// `subjectQuery` is deliberately normalized with `?? ""`: a null subjectQuery
// (page-level evidence with no associated query) and an empty-string
// subjectQuery are meant to collapse onto the same key, not be treated as
// distinct evidence.
export function computeEvidenceDedupeKey(input: {
  organizationId: string;
  projectId: string;
  source: TrendbriefEvidenceSource;
  evidenceType: TrendbriefEvidenceType;
  subjectUrl: string;
  subjectQuery: string | null;
  observationStart: string;
  observationEnd: string;
}): string {
  return [
    input.organizationId,
    input.projectId,
    input.source,
    input.evidenceType,
    input.subjectUrl,
    input.subjectQuery ?? "",
    input.observationStart,
    input.observationEnd,
  ].join("::");
}

// Deliberately excludes the observation window: the SAME opportunity must be
// updated (not duplicated) every time the detector re-runs, however often the
// underlying evidence window shifts. See specs/0012 "Idempotency".
export function computeOpportunityDedupeKey(input: {
  organizationId: string;
  projectId: string;
  detectorKey: string;
  subjectUrl: string;
  subjectQuery: string | null;
}): string {
  return [
    input.organizationId,
    input.projectId,
    input.detectorKey,
    input.subjectUrl,
    input.subjectQuery ?? "",
  ].join("::");
}
