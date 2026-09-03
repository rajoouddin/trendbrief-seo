# TrendBrief pause checkpoint — 2026-09-03

Status: **PAUSED** while Neo v1 is prioritised.

This is the durable handoff for the TrendBrief SEO SaaS work. Resume from this record rather than relying on prior chat history.

## 1. Product direction and decisions already made

TrendBrief has been repositioned away from the earlier newsletter/trending-topic product direction.

The current hypothesis is a low-cost, action-oriented SEO SaaS built on top of OpenSEO where useful.

The product should **not** be positioned as a simple "cheaper Semrush" or a rebranded OpenSEO fork. OpenSEO itself already provides a low-cost hosted product, so price alone is not a defensible differentiator.

The intended TrendBrief value proposition is:

> TrendBrief tells a non-SEO expert what they should do next to improve organic search performance, explains why it matters, helps them complete the work, and later measures what happened.

The core product loop is:

```text
SEO evidence
  -> deterministic opportunity detection
  -> prioritisation and confidence
  -> grounded recommendation
  -> user action
  -> later outcome measurement
  -> next brief
```

Key architectural decisions:

1. **Use OpenSEO as a technical foundation, not as the finished product.**
2. **Retain/reuse underlying SEO acquisition/platform capabilities where sensible.**
3. **Build a separate TrendBrief intelligence/workflow layer above them.**
4. **Evidence must precede recommendation.**
5. **Deterministic rules should identify opportunities before an LLM is used.**
6. **LLMs may explain, cluster, summarise, and draft, but must not control authorization, billing, measurements, or spend decisions.**
7. **TrendBrief should be action-centred rather than tool/dashboard-centred.**
8. **Automatic modification/publishing of customer websites is out of MVP scope.**
9. **MVP should validate one useful recommendation loop before broad feature expansion.**
10. **Keep TrendBrief isolated from unrelated ArEm/Enarra/Website Landlord repositories and workflows.**

## 2. Verified OpenSEO feasibility result

A read-only Codex engineering feasibility assessment was completed before implementation.

Assessment baseline at the time of review:

- upstream repository: `every-app/open-seo`
- inspected branch: `main`
- inspected commit: `ac9ee482d2b4cd8f472065d6f9b57db35cec560e`
- package version at that inspected point: `0.1.7`

Overall Codex verdict:

- **GO, conditionally**
- complexity classification: **LARGE REWORK**
- interpretation: OpenSEO is a strong engineering foundation but not a ready-to-rebrand TrendBrief product.

Verified reusable OpenSEO capabilities include substantial existing support for:

- organizations and projects
- role-based membership checks
- Better Auth
- hosted/self-hosted deployment modes
- subscriptions and usage credits
- DataForSEO integration and metering
- Google Search Console
- Google Analytics 4
- keyword research
- rank tracking
- competitor/domain research
- backlinks
- site audits
- Cloudflare Workers deployment
- PostgreSQL and D1 schema support
- background workflows and cron
- MCP and AI-agent infrastructure
- GDPR-erasure tooling

Important implementation evidence identified during the assessment:

- organization/member model: `src/db/better-auth-schema.ts`
- tenant-aware request middleware: `src/middleware/ensureUser.ts`, `src/serverFunctions/middleware.ts`
- role/permission logic: `src/lib/org-permissions.ts`
- DataForSEO charging/client path: `src/server/lib/dataforseo/client.ts`
- billing/subscription logic: `src/server/billing/subscription.ts`
- GSC integration: `src/shared/gsc.ts`, `src/server/features/gsc/services/GscService.ts`
- existing narrow search-opportunity prototype: `src/server/features/ga4/services/SearchOpportunityService.ts`
- rank scheduler: `src/server/features/rank-tracking/services/scheduledRankChecks.ts`
- site-audit URL policy: `src/server/lib/audit/url-policy.ts`
- crawler implementation: `src/server/workflows/siteAuditWorkflowCrawl.ts`
- audit limits: `src/shared/audit-limits.ts`
- AI/SAM tool surface: `src/server/features/sam/samChatTools.ts`
- MCP server: `src/server/mcp/server.ts`
- GDPR erasure runbook: `runbooks/gdpr-erasure.md`
- Cloudflare deployment: `alchemy.run.ts`

A particularly useful finding is that `SearchOpportunityService.ts` already contains a narrow prototype that joins GSC pages around positions 4–20 with GA4 outcomes and scores demand, business value, and reachability. It is not the TrendBrief domain model, but it provides a useful starting point for the first detector.

## 3. Verified repository state at pause

Dedicated TrendBrief fork:

- repository: `rajoouddin/trendbrief-seo`
- type: GitHub fork
- upstream parent/source: `every-app/open-seo`
- default branch: `main`
- visibility: public
- user has admin/push access

At checkpoint start, fork `main` was at:

`3632f408528cd588fec98c3a174af8ea0ad205e8`

Upstream `every-app/open-seo` `main` was independently checked and was at the same commit:

`3632f408528cd588fec98c3a174af8ea0ad205e8`

Therefore the fork was synchronized with upstream before this documentation-only checkpoint commit.

The two commits after the original Codex inspection baseline were upstream commits, not TrendBrief implementation work:

- `5b242b225af09974776fa78b7a068c049f435161` — `Blog: Two Surfaces, Two Timelines (#278)`
- `3632f408528cd588fec98c3a174af8ea0ad205e8` — `Blog: What Broke the $99 Ceiling (#277)`

No TB-001 implementation commit existed before this checkpoint.

No TrendBrief-specific source-code changes had been made.

No deployment had been performed.

No production credentials or paid provider actions were used for TrendBrief implementation.

No unrelated repository was modified as part of this checkpoint.

## 4. Important risks and conditions before public launch

These were identified in the feasibility assessment and remain unresolved.

### High priority

1. **Spend controls are not strong enough for a commercial multi-tenant TrendBrief launch.**
   - Existing credit admission can permit concurrent expensive calls before actual charges are recorded.
   - TrendBrief will need atomic reservation/idempotency/per-tenant limits and a global provider-spend circuit breaker before public paid usage.

2. **AI tool permissions are too broad for TrendBrief's intended trust model.**
   - Existing agent flows can access paid and mutating tools while untrusted scraped content may enter context.
   - TrendBrief should use narrowly scoped read-only tools by default and deterministic server-side approval for state changes/spend.

### Medium priority

3. **Tenant isolation is application-enforced.**
   - Existing organization/project scoping is a good base, but there is no database RLS and comprehensive TrendBrief cross-tenant IDOR coverage still needs to be added.

4. **Crawler/onboarding URL handling needs hardening before public SaaS launch.**
   - Exact-origin validation issue was identified in onboarding sitemap parsing.
   - DNS resolution fail-open/TOCTOU behaviour should be hardened and regression-tested.

5. **GSC OAuth production readiness is external work.**
   - Public Google OAuth verification/branding/privacy requirements may affect launch timing.

6. **DataForSEO commercial use must be confirmed for TrendBrief's exact hosted multi-tenant model.**
   - No technical blocker was found, but written commercial/redistribution confirmation should be obtained before launch.

7. **Privacy/data lifecycle work remains.**
   - Account/org deletion, retention, DSAR/export, OAuth revocation, processor/subprocessor documentation, analytics/session replay governance, and support/breach processes are not yet TrendBrief-ready.

8. **Pricing is still a hypothesis.**
   - Initial thinking was approximately £19/month for a one-site Starter plan and approximately £49/month for Growth, but no pricing is approved until per-plan COGS and willingness-to-pay are validated.

## 5. Work deliberately not started

The following have **not** been implemented and should not be treated as completed:

- TrendBrief branding or new UI
- TrendBrief opportunity/evidence/action/outcome database model
- TB-001 detector
- paid-plan changes
- free diagnostic
- new onboarding
- scheduler for TrendBrief briefs
- notifications
- automatic website changes
- AI recommendation orchestration
- new spend controls
- new tenancy/RLS changes
- Google production OAuth work
- DataForSEO contractual confirmation
- public deployment

## 6. Agreed MVP validation approach

Do not start by rebuilding all of OpenSEO or reproducing Semrush/Ahrefs feature breadth.

The first proof should be one narrow vertical slice:

```text
GSC evidence
  -> persisted normalized evidence
  -> deterministic striking-distance opportunity
  -> deterministic/grounded recommendation record
  -> accept/reject/complete lifecycle
  -> later outcome record
```

The first detector should focus on a page/query combination with:

- existing Google Search Console impressions
- average ranking position within a configurable striking-distance range, initially approximately positions 4–20
- a minimum meaningful impression threshold
- business relevance either supported by existing structured context or explicitly marked as requiring confirmation

No LLM is required for detector execution.

No new paid DataForSEO calls should be introduced for this first slice.

## 7. TB-001 domain requirements already decided

The first TrendBrief domain layer should cover:

### Evidence

Persist normalized, machine-readable source evidence with:

- organization ID
- project ID
- source/evidence type
- page/URL where relevant
- query/topic where relevant
- observation window
- captured timestamp
- metrics/value payload
- lineage/reference
- freshness
- deduplication semantics

### Opportunity

Persist:

- organization ID
- project ID
- detector ID/version
- type
- subject URL/query/topic
- lifecycle status
- impact
- effort
- confidence
- priority
- first/last detected
- stale/expiry handling
- rationale codes
- deduplication key

### Opportunity-evidence relationship

An opportunity must link back to the exact evidence that produced it.

### Recommendation

First version should be deterministic and structured. It may state that a page should be investigated/improved and why, but it must not invent content changes not supported by evidence.

### Action

Support at minimum:

- accept
- reject
- mark completed

### Outcome

Support later comparison of baseline and comparison windows with classifications such as:

- improved
- unchanged
- declined
- inconclusive

Do not claim causal attribution. Preferred language is equivalent to:

> Performance improved after the recorded action.

not:

> This action caused performance to improve.

## 8. Architecture constraints for TB-001

When implementation resumes:

- preserve existing OpenSEO auth/org/project/GSC service layers
- keep TrendBrief-specific logic isolated rather than scattering it across existing feature modules
- explicitly store `organization_id` and `project_id` on new customer-owned TrendBrief records
- enforce tenant-aware reads/writes
- add cross-tenant read/write tests
- version detectors, for example conceptually `gsc-striking-distance:v1`
- make repeated analysis idempotent
- keep scoring deterministic and inspectable
- keep recommendation provenance traceable
- preserve D1/Postgres schema-parity conventions unless a reviewed architectural decision changes this
- do not make MCP the internal orchestration backbone by default
- do not introduce new paid API calls for the first slice
- treat search queries, URLs, titles, and external page text as untrusted data

A suggested module boundary from the prior design is conceptually:

```text
src/server/features/trendbrief/
  domain/
  repositories/
  services/
  detectors/
  scoring/
```

This is illustrative; repository conventions should determine final paths.

## 9. Acceptance target for the first resumed implementation

TB-001 should not be considered successful because it adds many features.

It succeeds only if it proves that TrendBrief can:

1. ingest/normalize real GSC evidence;
2. identify one useful opportunity deterministically;
3. explain exactly why the opportunity exists using traceable evidence;
4. calculate inspectable priority/confidence;
5. avoid duplicate opportunities on repeated analysis;
6. maintain organization/project tenant boundaries;
7. persist a deterministic recommendation;
8. record accept/reject/complete actions;
9. create the foundation for later outcome measurement;
10. do all of the above without new automatic paid provider calls or an LLM dependency.

## 10. Recommended sequence after TB-001

Do not commit to this sequence until TB-001 is reviewed, but the current expected progression is:

1. **TB-001:** evidence/opportunity/action/outcome vertical slice
2. independent Codex review of TB-001 architecture/security
3. **TB-002:** minimal action-oriented TrendBrief interface around the verified domain layer
4. internal dogfooding
5. free diagnostic experiment
6. first paid Starter beta only after commercial/security launch conditions are satisfied

## 11. Exact recommended next step when work resumes

**Do not resume with more broad market research or UI work.**

Start a dedicated TrendBrief/OpenSEO coding session rooted in the `rajoouddin/trendbrief-seo` fork and perform a fresh baseline check against `every-app/open-seo`.

Then implement **TB-001 only**: the evidence-driven GSC striking-distance vertical slice described above.

Before implementation:

1. inspect local branch/HEAD/working tree;
2. fetch `origin` and `upstream`;
3. verify whether upstream moved since this checkpoint;
4. review upstream delta before merging/syncing;
5. preserve any unrelated local changes;
6. confirm the existing GSC and `SearchOpportunityService` architecture still matches the assumptions in this record;
7. stop and reassess if upstream changes materially invalidate the design.

Do not start TB-002 or public launch work in the same task.

## 12. RESUME FROM HERE

TrendBrief SEO is paused after feasibility validation and repository establishment, before implementation.

Use repository:

`rajoouddin/trendbrief-seo`

Upstream:

`every-app/open-seo`

The fork was synchronized with upstream at `3632f408528cd588fec98c3a174af8ea0ad205e8` immediately before this checkpoint record was added.

The product decision is **GO WITH CONDITIONS**.

OpenSEO is the underlying platform/SEO foundation. TrendBrief's differentiator is the new evidence -> opportunity -> recommendation -> action -> outcome layer.

**Next task: implement TB-001 only, starting with fresh Git/upstream verification and then the deterministic GSC striking-distance vertical slice. Do not start a rebrand, broad UI work, billing changes, or paid-provider expansion.**
