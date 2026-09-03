# TrendBrief evidence-driven opportunity domain (TB-001)

## Status

Accepted

## Context

OpenSEO exposes SEO measurements and research tools (GSC, GA4, DataForSEO) but has no durable, persisted "opportunity" concept — `SearchOpportunityService` (`src/server/features/ga4/services/SearchOpportunityService.ts`) computes a scored, joined GSC/GA4 view on every call and persists nothing. TrendBrief needs a decision-and-workflow layer above OpenSEO's acquisition layer: given real SEO evidence, identify a useful opportunity deterministically, explain exactly why it exists, remember what the user decided, and lay the foundation for measuring what happened afterwards. TB-001 is the first vertical slice proving that loop end to end for one opportunity type: a GSC striking-distance opportunity (a page/query already receiving impressions, ranking close enough to strong visibility that improving the page may beat creating new content).

## Decision

Add a new `src/server/features/trendbrief/` domain layer (`domain/`, `scoring/`, `repositories/`, `services/`, `detectors/`) and six new tables (`trendbrief_evidence`, `trendbrief_opportunities`, `trendbrief_opportunity_evidence`, `trendbrief_recommendations`, `trendbrief_actions`, `trendbrief_outcomes`), hand-written for both D1 and Postgres and guarded by the existing `schema-parity.test.ts`.

**Evidence first.** Evidence is a normalized, machine-readable measurement (currently GSC page+query performance only) with a deduplication key covering the observation window, so re-ingesting the same window is idempotent. An opportunity can only be created from persisted evidence, and the `trendbrief_opportunity_evidence` join table lets a reviewer trace every opportunity back to the exact rows that produced it. Source lineage beyond `source`/`evidenceType`/the observation window is resolved via the project's single GSC connection (`gsc_connections`, unique per project) rather than duplicated onto every evidence row — a project has at most one connected property at a time, so `projectId` alone is enough to look up which Search Console property an evidence row came from.

**Deterministic detection, versioned.** The first (and only, for TB-001) detector — `gsc-striking-distance:v1` — is a pure function over persisted evidence: no LLM call decides whether something is a good opportunity. Detector identity (`detectorId` + `detectorVersion`) is persisted on every opportunity row, so a future scoring change is distinguishable from a past decision.

**Idempotent re-detection.** An opportunity's dedupe key (organization + project + detector key + subject page/query) deliberately excludes the observation window, so re-running the detector daily updates one row (`lastDetectedAt`, scores) instead of creating a new one — and never silently reverts a human decision (`accepted`/`rejected`/etc.) back to `detected`.

**Deterministic recommendation, AI-enrichable later.** Each opportunity gets exactly one recommendation row, entirely templated from measured fields (page, rationale codes, suggested next analysis) — `generationMethod: "deterministic"`. The schema has room for a future AI-authored explanation (a version bump, or a future `generationMethod: "llm"` row) without changing this baseline.

**Commercial relevance reuses existing structured data.** Rather than building a new relevance model, the detector matches a candidate's subject URL against the project's existing, human-curated `project_key_pages` list (`ProjectContextRepository.listKeyPages`). A match marks `relevanceStatus: "confirmed"`; no match marks it `"unconfirmed"` (not rejected) — the opportunity is still created, with a lower confidence and priority score, rather than pretending certainty the data doesn't support.

**Inspectable scoring.** `priority = demand x reachability x businessRelevance x confidence x (1 - effort)`, with every component persisted on the opportunity row and every threshold a named constant in `scoring/constants.ts`. Confidence blends evidence freshness, sample size (impressions), relevance confirmation, and (currently unused, single-source) source agreement.

**Explicit tenant ownership.** Every new table carries both `organization_id` and `project_id`; every repository read/update takes an explicit `projectId` filter (`getForProject`, `listForProject`, `updateStatus`), so a guessed opportunity ID belonging to a different project returns nothing. The MCP tool surface (`analyze_trendbrief_opportunities`, `list_trendbrief_opportunities`, `set_trendbrief_opportunity_status`, `record_trendbrief_outcome`) reuses the existing `withMcpProjectAuth` gate — no new authorization mechanism.

**No LLM, no new paid calls.** The entire slice — evidence collection, detection, scoring, recommendation, lifecycle, outcome — runs without an LLM API call or a DataForSEO call. Evidence collection is a thin adapter over the existing, free `GscService.getPerformance`.

## Rationale

Reusing `GscService.getPerformance` and `ProjectContextRepository.listKeyPages` instead of building new integrations keeps this a genuinely minimal vertical slice and avoids introducing a second GSC client or a second "what pages matter" concept. Mirroring the existing MCP-tool convention for the execution route (rather than inventing an admin panel) matches how every other manually-triggered, project-scoped action in this codebase already works. Excluding the observation window from the opportunity (but not the evidence) dedupe key is the specific design choice that makes "re-running the detector doesn't duplicate opportunities" true without adding a separate reconciliation step.

## Consequences

- Evidence volume is bounded to striking-distance rows only (position 4-20); non-qualifying GSC rows are never persisted, so re-running analysis daily does not accumulate unbounded evidence.
- A project with no `project_key_pages` entries will have every opportunity's relevance marked `unconfirmed`, lowering its confidence/priority even for genuinely commercially relevant pages — a known false-negative risk the brief explicitly permits over inventing an unverified relevance signal.
- `trendbrief_opportunities.status` models `expired`/`superseded` (and the `completed -> measuring -> {successful,inconclusive,unsuccessful}` chain) as recognized values, but TB-001 does not implement the automatic transitions into them — `expiresAt` is stored but nothing currently reads it, and `record_trendbrief_outcome` writes an outcome without forcing the opportunity through `measuring` first. A future slice should decide whether the outcome recording itself should drive that transition.
- `TrendbriefOpportunityRepository.upsertFromDetection` and `TrendbriefOpportunityLifecycleService`'s status+action writes are sequential, non-atomic writes, not wrapped in `runBatch` (`src/db/runBatch.ts`). Acceptable for TB-001's single-operator execution model; a concurrent-writer or scheduled-production version of this slice should wrap both in a transaction.
- New TrendBrief capabilities should extend `src/server/features/trendbrief/` and its four MCP tools, keeping detection deterministic and evidence-traceable, per the principles above.
