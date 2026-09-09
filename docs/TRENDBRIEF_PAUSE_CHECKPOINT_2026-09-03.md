# TrendBrief pause checkpoint — 2026-09-03

Status: **PRODUCT / COMMERCIAL VALIDATION APPROVED; TB-002 NOT AUTHORISED**.

This is the durable handoff for TrendBrief SEO. Resume from this record rather than relying on prior chat history.

## Product direction

TrendBrief has been repositioned away from the earlier newsletter/trending-topic direction into a potential low-cost, action-oriented SEO SaaS.

Do **not** position it as a simple cheaper Semrush clone or an OpenSEO rebrand. OpenSEO is the technical/SEO foundation; TrendBrief's differentiation is an evidence-driven decision and workflow layer for non-SEO experts.

Intended product loop:

```text
SEO evidence
  -> deterministic opportunity detection
  -> prioritisation/confidence
  -> grounded recommendation
  -> user action
  -> later outcome measurement
  -> next brief
```

Standing architecture decisions:

1. Reuse OpenSEO platform and SEO acquisition capabilities where sensible.
2. Keep TrendBrief-specific domain logic isolated above those capabilities.
3. Evidence must precede recommendations.
4. Deterministic rules identify opportunities before any LLM enrichment.
5. LLMs may explain, cluster, summarise and draft, but must not control authorization, billing, measurements or spend decisions.
6. The product UX should be action-centred rather than a conventional SEO-tool dashboard.
7. Automatic modification/publishing of customer websites remains outside the initial MVP.
8. Keep TrendBrief isolated from unrelated ArEm, Enarra, Website Landlord and other repositories/workflows.

## OpenSEO feasibility decision

A read-only Codex assessment established that OpenSEO is a credible engineering foundation but not a ready-to-rebrand TrendBrief product.

Original inspected upstream baseline:

- repository: `every-app/open-seo`
- branch: `main`
- inspected commit: `ac9ee482d2b4cd8f472065d6f9b57db35cec560e`
- package version at review: `0.1.7`

Verdict: **GO WITH CONDITIONS**.

Useful existing capabilities include organizations/projects, role checks, Better Auth, subscriptions/usage credits, DataForSEO, GSC, GA4, rank tracking, site audits, Cloudflare deployment, D1/Postgres support, workflows/cron, MCP and AI-agent infrastructure.

Important source references from the assessment include:

- `src/db/better-auth-schema.ts`
- `src/middleware/ensureUser.ts`
- `src/serverFunctions/middleware.ts`
- `src/lib/org-permissions.ts`
- `src/server/lib/dataforseo/client.ts`
- `src/server/billing/subscription.ts`
- `src/shared/gsc.ts`
- `src/server/features/gsc/services/GscService.ts`
- `src/server/features/ga4/services/SearchOpportunityService.ts`
- `src/server/features/rank-tracking/services/scheduledRankChecks.ts`
- `src/server/lib/audit/url-policy.ts`
- `src/server/workflows/siteAuditWorkflowCrawl.ts`
- `src/server/features/sam/samChatTools.ts`
- `src/server/mcp/server.ts`
- `runbooks/gdpr-erasure.md`
- `alchemy.run.ts`

## Repository

Dedicated product repository:

- `rajoouddin/trendbrief-seo`
- GitHub fork of `every-app/open-seo`
- default branch: `main`
- public repository

The fork was initially synchronized with upstream at:

`3632f408528cd588fec98c3a174af8ea0ad205e8`

The first pause checkpoint was then committed as:

`c0206b49cf04c1a9b7c5a2725a98a27cb049635d`

## TB-001 — completed and merged

TB-001 was subsequently implemented on branch `tb-001`, reviewed, pushed and merged through PR #1:

`https://github.com/rajoouddin/trendbrief-seo/pull/1`

Verified PR state:

- PR #1: **merged**
- title: `TB-001: TrendBrief evidence-driven opportunity domain (vertical slice)`
- base: `main`
- head: `tb-001`
- head SHA: `3e8693bf5490b5061ee216d863cc7daaffa0d10d`
- merge commit: `afe53865a624a533d549b5dab6ad367a2a3e7a0b`

TB-001 implements the first internal TrendBrief vertical slice:

```text
GSC evidence
  -> deterministic striking-distance detection
  -> persisted opportunity
  -> deterministic recommendation
  -> accept/reject/complete action
  -> outcome comparison
```

### Implemented domain layer

New TrendBrief feature area under `src/server/features/trendbrief/` with domain, scoring, repository, service and detector components.

Six new domain tables were added for both D1 and Postgres:

- evidence
- opportunities
- opportunity/evidence relationships
- recommendations
- actions
- outcomes

Schema parity is guarded by the existing `schema-parity.test.ts`.

### Detector

First detector:

`gsc-striking-distance:v1`

It reuses existing `GscService.getPerformance` and does not introduce a new GSC integration or DataForSEO call.

Commercial relevance reuses existing `project_key_pages` through `ProjectContextRepository.listKeyPages` rather than inventing an AI relevance model. Projects without configured key pages receive unconfirmed relevance rather than false confirmation.

### Tenant/security boundary

Four MCP tools were added:

- `analyze_trendbrief_opportunities`
- `list_trendbrief_opportunities`
- `set_trendbrief_opportunity_status`
- `record_trendbrief_outcome`

They use the existing `withMcpProjectAuth` tenant authorization wrapper.

Cross-tenant tests verify that a foreign organization's `projectId` is rejected before TrendBrief service/repository calls execute.

### Verification reported for the merged branch

- `npx tsc --noEmit`: clean
- `npx oxlint . --type-aware`: 0 warnings / 0 errors
- Prettier: clean on touched files; one pre-existing plan-document formatting issue was intentionally not broadly reformatted
- full tests: **154 files / 1267 tests passing**
- D1/Postgres structural parity verified for all six new tables
- no `dataforseo` references in the new TrendBrief feature
- repeated analysis with unchanged evidence is idempotent rather than producing duplicate active opportunities

The implementation was built through a 15-task plan with task-level reviews and a final whole-branch review. Review-found defects including outcome misclassification, half-specified date handling, a misleading test name and a vacuous tenant-isolation test were corrected before merge.

Architecture record:

`specs/0012-trendbrief-opportunity-domain.md`

Implementation plan:

`docs/superpowers/plans/2026-09-03-tb-001-trendbrief-opportunity-domain.md`

## TB-001 post-merge hardening — completed and merged

The five valid findings from the post-TB-001 review were remediated on
`fix/tb-001-review-hardening` and merged through PR #2:

`https://github.com/rajoouddin/trendbrief-seo/pull/2`

Verified integration state:

- PR #2: **merged**
- head SHA: `a479e0997ba95bd55b008316e7c228990803a165`
- merge commit: `5f8c878b1a3ad5d2f7db998abc7b6c786a532d5d`
- merge method: merge commit

The hardening change provides:

1. completed-only outcome measurement;
2. real, ordered and non-overlapping outcome windows;
3. complete outcome-window refresh during outcome upsert;
4. latest-action actor attribution on action updates; and
5. unambiguous versioned dedupe keys, with natural-key-scoped legacy lookup
   and lazy rekeying when a matching legacy row is touched.

Final validation of the PR head passed 18 targeted TrendBrief/schema/MCP test
files with 301 tests, including cross-tenant MCP rejection tests; the full
repository suite passed 155 files with 1,287 tests. TypeScript, type-aware
Oxlint, touched-file Prettier and `git diff --check` were clean. An independent
Claude Code final review returned **PASS** with no blocking findings. The merge
tree was verified to contain the PR head exactly for the affected TrendBrief
and MCP paths, and the 301-test targeted suite plus TypeScript were rerun after
merge. No paid-provider integration, new infrastructure or TB-002 product work
was introduced.

## Known TB-001 follow-up

These are not blockers for the current pause but must not be forgotten:

1. Legacy dedupe keys migrate lazily only when the matching row is touched.
2. Historical data already lost through a genuine legacy dedupe-key collision
   cannot be reconstructed automatically without replaying external evidence.
3. TrendBrief multi-write flows are not yet wrapped in `runBatch`; the
   documented atomicity and round-trip-volume limitation remains intentionally
   outside the hardening scope and must be revisited before scheduled or
   high-volume operation.
4. `expired` and `superseded` opportunity states are modelled but are not yet automatically transitioned.
5. Some list queries remain unbounded and should be reviewed before production scale.
6. Some planned/dead helper code may remain unwired and can be cleaned only when an established use warrants it.

## Broader unresolved launch risks

The original feasibility risks still stand unless explicitly remediated later:

- atomic/per-tenant/global paid-provider spend controls before commercial paid usage
- narrow AI tool permissions and prompt-injection protections
- continued tenant-isolation assurance; existing app-level enforcement has no Postgres RLS
- crawler/onboarding exact-origin and DNS fail-closed hardening
- Google production OAuth verification/readiness
- written confirmation of DataForSEO terms for the exact hosted multi-tenant TrendBrief model
- privacy/retention/export/deletion/subprocessor work
- pricing and per-plan COGS validation

Initial pricing ideas such as approximately £19 Starter and £49 Growth remain hypotheses, not approved prices.

## Work not yet started/completed

Do not treat the following as complete:

- final TrendBrief product UX or branding
- TB-002 action-oriented interface
- internal real-world dogfooding of TB-001 with a connected project
- free diagnostic funnel
- commercial pricing/entitlement redesign
- production scheduling/brief generation
- notifications
- AI recommendation enrichment/generation layer
- automatic publishing/site modification
- production spend-control redesign
- Google OAuth production work
- DataForSEO contractual confirmation
- public TrendBrief deployment

## Recommended next step when work resumes

**Do not reimplement TB-001 or assume TB-002 is next. Both TB-001 and its
post-merge hardening are integrated.**

TrendBrief now returns to product/commercial validation and MVP definition.
The next product decision must establish:

> What is the smallest SEO problem TrendBrief can solve clearly and usefully
> for a specific customer who will pay for it?

Do not begin a new detector family, public UI, billing, AI recommendations,
scheduling, automatic publishing, paid API integration, new infrastructure or
speculative Semrush/Ahrefs-style capability until that decision is made. No
TB-002 implementation work has begun.

## RESUME FROM HERE

TrendBrief SEO is paused **after TB-001 implementation and merge**.

Repository: `rajoouddin/trendbrief-seo`

Upstream: `every-app/open-seo`

TB-001 PR: `#1`

TB-001 head: `3e8693bf5490b5061ee216d863cc7daaffa0d10d`

TB-001 merge commit: `afe53865a624a533d549b5dab6ad367a2a3e7a0b`

TB-001 hardening PR: `#2`

TB-001 hardening head: `a479e0997ba95bd55b008316e7c228990803a165`

TB-001 hardening merge commit: `5f8c878b1a3ad5d2f7db998abc7b6c786a532d5d`

Product decision remains **GO WITH CONDITIONS**.

OpenSEO remains the platform/SEO foundation. TrendBrief's differentiator is now represented in code by the evidence -> opportunity -> recommendation -> action -> outcome domain.

**Next: product/commercial validation and MVP definition. Determine the
smallest clearly useful SEO problem for a specific paying customer. Do not
start TB-002 or another product feature until that decision is established.**

## Product-validation direction approved — 2026-09-05

Raj approved the product-validation direction recommended by ChatGPT through
the Neo advisor bridge:

> Test a GSC-first “three actions that matter” workflow for freelance
> web/marketing consultants and micro-agencies managing roughly 3–20 SMB
> websites.

The narrow job is to turn existing GSC evidence into at most three prioritised,
understandable SEO actions, retain the operator's decision, and later compare
before/after evidence. This remains a falsifiable hypothesis rather than proof
of demand or an approved final product promise.

The approved validation sequence is:

1. at least eight qualified problem interviews;
2. a five-user, two-cycle concierge pilot using authorised real GSC data; and
3. real willingness-to-pay testing at £19–£29/month.

No TB-002 implementation is authorised unless all recorded thresholds pass.
The durable validation plan, interview guide, pilot workflow, scorecards,
privacy boundaries and GO/NO-GO rules are in:

`docs/TRENDBRIEF_MVP_VALIDATION_PLAN.md`

Decision evidence:

- advisor request and response: `rajoouddin/neo` issue #2;
- request ID: `NEO-ADV-20260905-195516Z`; and
- Raj approval record:
  `https://github.com/rajoouddin/neo/issues/2#issuecomment-5554440117`.

**Next permitted work: Stage 1 prospect recruitment and problem interviews.
Do not build a public UI, new detector, paid-data integration or TB-002.**

## TB-001 real-data validation checkpoint — 2026-09-09

TB-001 was exercised against two real, authorised Search Console properties:
Enarra and Cheltenham Tree Surgery.

Technical findings — TB-001 technical viability is **proven**:

- real Google OAuth/GSC integration works;
- evidence ingestion works;
- deterministic detection works;
- persistence and dedupe work;
- tenant/project isolation works;
- repeated runs are idempotent;
- no DataForSEO or LLM calls are required.

Product-validation findings:

- neither property produced a useful non-brand opportunity under the existing
  detector;
- Enarra is brand-dominated;
- Cheltenham has extremely low search volume;
- extending the comparison window from 28 to 90 days caused only brand
  navigation cells on Enarra to cross the 50-impression floor;
- no useful non-brand cells crossed the floor;
- no third materially higher-volume SMB property is available on the currently
  authorised GSC grants.

Product decision — record explicitly:

- DO NOT change the default 28-day window based on current evidence.
- DO NOT change the >= 50 impression floor based on current evidence.
- DO NOT change detector logic based on current evidence.
- DO NOT tune against the existing two properties.
- TB-001 technical viability is proven.
- TB-001 product usefulness / willingness-to-pay remains unvalidated.
- Further detector calibration requires a suitable external property from a
  qualified validation participant or pilot.
- Commercial/customer validation remains the gating work before broader product
  development.

Consequence: no detector, window, threshold, brand-filtering or key-page
behaviour change is made from this evidence, and no TB-002 work begins.
