# TrendBrief pause checkpoint — 2026-09-03

Status: **PAUSED** while Neo v1 is prioritised.

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

## Known TB-001 follow-up

These are not blockers for the current pause but must not be forgotten:

1. TrendBrief multi-write flows are not yet wrapped in `runBatch`; atomicity/round-trip volume should be revisited before scheduled/high-volume operation.
2. `expired` and `superseded` opportunity states are modelled but are not yet automatically transitioned.
3. Some list queries remain unbounded and should be reviewed before production scale.
4. Some planned/dead helper code may remain unwired and can be cleaned when the next slice establishes actual usage.
5. The local `.worktrees/tb-001` worktree was intentionally retained after the PR for feedback/follow-up; check whether it still exists and is needed when resuming.

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

**Do not reimplement TB-001. It is merged.**

Resume with a controlled verification/review step before TB-002:

1. Open `rajoouddin/trendbrief-seo` in a dedicated TrendBrief session.
2. Inspect local working tree and `.worktrees/tb-001`; preserve unrelated work and remove nothing blindly.
3. Fetch `origin` and `upstream` and establish the current divergence since merge commit `afe53865a624a533d549b5dab6ad367a2a3e7a0b`.
4. Confirm `main` contains PR #1 and run the relevant validation suite if the local environment has changed.
5. Review `specs/0012-trendbrief-opportunity-domain.md` and PR #1's documented follow-ups.
6. Perform the intended independent post-merge architecture/security review of TB-001 if that has not already been done by the reviewing agent at the required independence level.
7. Then define/implement **TB-002 only**: the smallest action-oriented interface that lets an internal user exercise the verified TB-001 lifecycle and dogfood it with real GSC data.
8. Do not broaden into billing, public launch, AI autopilot or additional SEO detector families until this internal product loop has been tested for actual usefulness.

## RESUME FROM HERE

TrendBrief SEO is paused **after TB-001 implementation and merge**.

Repository: `rajoouddin/trendbrief-seo`

Upstream: `every-app/open-seo`

TB-001 PR: `#1`

TB-001 head: `3e8693bf5490b5061ee216d863cc7daaffa0d10d`

TB-001 merge commit: `afe53865a624a533d549b5dab6ad367a2a3e7a0b`

Product decision remains **GO WITH CONDITIONS**.

OpenSEO remains the platform/SEO foundation. TrendBrief's differentiator is now represented in code by the evidence -> opportunity -> recommendation -> action -> outcome domain.

**Next: verify the merged/local/upstream state, complete any required independent post-merge TB-001 review, then move to TB-002: a minimal internal action-oriented interface for real dogfooding. Do not restart TB-001 or jump to public launch work.**
