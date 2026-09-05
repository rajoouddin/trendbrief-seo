import type { TrendbriefEvidenceSource, TrendbriefEvidenceType } from "./types";

const DEDUPE_KEY_VERSION = "v2";

function encodeDedupeComponents(components: string[]): string {
  return `${DEDUPE_KEY_VERSION}:${JSON.stringify(components)}`;
}

export type EvidenceDedupeInput = {
  organizationId: string;
  projectId: string;
  source: TrendbriefEvidenceSource;
  evidenceType: TrendbriefEvidenceType;
  subjectUrl: string;
  subjectQuery: string | null;
  observationStart: string;
  observationEnd: string;
};

// `subjectQuery` is deliberately normalized with `?? ""`: a null subjectQuery
// (page-level evidence with no associated query) and an empty-string
// subjectQuery are meant to collapse onto the same key, not be treated as
// distinct evidence.
function evidenceComponents(input: EvidenceDedupeInput): string[] {
  return [
    input.organizationId,
    input.projectId,
    input.source,
    input.evidenceType,
    input.subjectUrl,
    input.subjectQuery ?? "",
    input.observationStart,
    input.observationEnd,
  ];
}

export function computeEvidenceDedupeKey(input: EvidenceDedupeInput): string {
  return encodeDedupeComponents(evidenceComponents(input));
}

export function computeLegacyEvidenceDedupeKey(
  input: EvidenceDedupeInput,
): string {
  return evidenceComponents(input).join("::");
}

// Deliberately excludes the observation window: the SAME opportunity must be
// updated (not duplicated) every time the detector re-runs, however often the
// underlying evidence window shifts. See specs/0012 "Idempotency".
export type OpportunityDedupeInput = {
  organizationId: string;
  projectId: string;
  detectorKey: string;
  subjectUrl: string;
  subjectQuery: string | null;
};

function opportunityComponents(input: OpportunityDedupeInput): string[] {
  return [
    input.organizationId,
    input.projectId,
    input.detectorKey,
    input.subjectUrl,
    input.subjectQuery ?? "",
  ];
}

export function computeOpportunityDedupeKey(
  input: OpportunityDedupeInput,
): string {
  return encodeDedupeComponents(opportunityComponents(input));
}

export function computeLegacyOpportunityDedupeKey(
  input: OpportunityDedupeInput,
): string {
  return opportunityComponents(input).join("::");
}
