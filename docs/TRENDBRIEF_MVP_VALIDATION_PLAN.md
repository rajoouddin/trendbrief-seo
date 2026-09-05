# TrendBrief MVP product-validation plan

Status: **APPROVED FOR VALIDATION — NO TB-002 IMPLEMENTATION AUTHORISED**

- Owner/approver: Raj
- Product direction: ChatGPT via the Neo advisor bridge
- Execution controller: Neo
- Approved: 2026-09-05

## 1. Decision

TrendBrief will initially test a GSC-first **“three actions that matter”** workflow for:

> Freelance web/marketing consultants and micro-agencies managing roughly 3–20 SMB websites, where the operator is responsible for SEO but is not a full-time SEO analyst.

The narrow job-to-be-done is:

> Turn existing Google Search Console evidence into a very short, prioritised list of SEO actions for pages that already have search momentum, explain why each action matters, and track whether the action helped.

The product promise to validate is:

> Connect Search Console. TrendBrief tells you the three SEO actions worth doing next across your client sites, explains exactly why, and tracks whether the change improved search performance.

This is an approved **validation hypothesis**, not a proven market fact, final product promise, guaranteed outcome, or approved final price.

## 2. Authority and evidence

- Raj approved this validation direction after receiving ChatGPT's product recommendation.
- Advisor task: `TRENDBRIEF-MVP-DEFINITION`
- Request ID: `NEO-ADV-20260905-195516Z`
- Advisor issue: <https://github.com/rajoouddin/neo/issues/2>
- ChatGPT response: <https://github.com/rajoouddin/neo/issues/2#issuecomment-5554407271>
- Raj approval record: <https://github.com/rajoouddin/neo/issues/2#issuecomment-5554440117>
- Durable technical checkpoint: `docs/TRENDBRIEF_PAUSE_CHECKPOINT_2026-09-03.md`
- Accepted TB-001 architecture: `specs/0012-trendbrief-opportunity-domain.md`

## 3. Current state

### Observed on 2026-09-05

- Repository: `rajoouddin/trendbrief-seo`.
- Branch: `main`.
- Local HEAD and live `origin/main`: `bd88953f5d99b237c58002ce4d29c7006100e421`.
- Worktree: clean, with no additional worktrees or stashes.
- PR #1 and PR #2 are merged.
- Repository search finds `TB-002` only in checkpoint statements saying it has not begun and must not begin yet.

### Established by accepted repository records

TB-001 proves an internal, tenant-scoped workflow for one opportunity family:

```text
GSC page/query evidence
→ deterministic striking-distance detection
→ persisted, inspectably scored opportunity
→ deterministic recommendation
→ accept/reject/complete action
→ before/after outcome comparison
```

The merged work includes six D1/Postgres-parity domain tables and four project-authorised MCP tools. The checkpoint records passing targeted and full test suites after hardening.

### Not established

- Product demand or product-market fit.
- A repeatable acquisition channel.
- GSC-only sufficiency for a paid product.
- Whether the current striking-distance detector routinely identifies commercially worthwhile work.
- Whether users act, return, or pay.
- Final pricing, entitlement design, UX, branding, or TB-002 acceptance criteria.

## 4. Hypotheses under test

| ID  | Hypothesis                                                                                               | Evidence required                                                                       |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A1  | Target operators have a recurring multi-site SEO-prioritisation problem.                                 | Independent interview descriptions of the current problem, frequency, and consequences. |
| A2  | GSC-only evidence can generate enough useful initial opportunities.                                      | Real-site pilot ratings and concrete examples of useful versus rejected candidates.     |
| A3  | A three-action queue is clearer and more valuable than another dashboard.                                | Relevance, clarity, and comparative workflow feedback.                                  |
| A4  | Operators execute at least some recommendations.                                                         | Recorded completed action with what changed and when.                                   |
| A5  | Outcome tracking helps operators manage or explain client value.                                         | Return usage and specific client/accountability examples.                               |
| A6  | The workflow has recurring monetary value.                                                               | Actual subscription payment or paid deposit/pre-order at the tested price.              |
| A7  | Limiting the queue to three actions feels focused, not artificially restrictive.                         | Direct pilot feedback and demand for more/less work.                                    |
| A8  | `gsc-striking-distance:v1` finds commercially worthwhile opportunities often enough to anchor the wedge. | Pilot operator judgement across real sites, including rejection reasons.                |

## 5. Scope and boundaries

### Included in validation

- Qualified-prospect recruitment and problem interviews.
- Manual/concierge use of suitable real GSC data with explicit permission.
- Existing TB-001 analysis and lifecycle capability where operationally safe.
- At most three opportunities per site or weekly cycle.
- Human-readable evidence, limitations, and recommended investigation/change.
- Recording acceptance, rejection, completion, outcome, and concise feedback.
- Testing a real recurring price of **£19 or £29 per month**.

### Excluded until the gates pass

- TB-002 or any public product UI.
- New detector families merely to improve a weak pilot result.
- DataForSEO or another paid evidence source.
- Automatic content generation, site modification, or publishing.
- Broad keyword, backlink, competitor, rank-tracking, site-audit, or AI-visibility products.
- Scheduling, notifications, white-label reporting, agency CRM, mobile apps, or complex billing tiers.
- Claims that TrendBrief causes ranking or traffic increases.

## 6. Stage 1 — problem interviews

### Recruitment target

Recruit 12–15 prospects to obtain at least **8 completed qualified interviews**.

A qualified prospect:

- is a freelance web/marketing consultant or works in a micro-agency;
- manages approximately 3–20 active SMB websites;
- personally owns or materially influences recurring SEO decisions;
- has access to, or regularly works with, Google Search Console data;
- is not employed primarily as a dedicated SEO analyst.

Record near-misses separately; do not count them toward the gate.

### Interview rule

Do not lead with the proposed product or ask whether the person likes it. First establish what they currently do, how often the problem occurs, what it costs, and what they already pay for.

### Core interview questions

1. Tell me about the websites you manage and what clients expect from you.
2. When did you last decide what SEO work to do next? Walk me through it.
3. Which data and tools did you use, and how long did the work take?
4. What makes prioritisation difficult across your sites?
5. What SEO work gets delayed or ignored, and why?
6. How do you decide whether a page is worth improving?
7. What do clients ask you to show about work completed or results?
8. Which SEO tools or services do you pay for today, and what job earns that spend?
9. Describe a recent recommendation you acted on. What happened next?
10. What would make a prioritised action untrustworthy or unusable?

Only after the problem discussion, show the concise hypothesis and ask:

- How would this fit or fail to fit your current workflow?
- Which part would save time, if any?
- What evidence would you need before acting?
- Would three actions feel focused or insufficient? Why?

### Interview record

For each participant, record:

```text
Participant ID:
Qualification: pass/fail, with reason
Sites managed:
Role and decision authority:
Current SEO review frequency:
Current workflow/tools:
Current paid SEO tools/services:
Recurring prioritisation problem described unprompted: yes/no
Material consequence/time cost:
Client proof/accountability need: yes/no + example
Evidence needed to trust an action:
Three-action reaction:
Exact notable quotes:
A1/A3/A5/A7 observations:
Follow-up/pilot suitability:
Consent/data-handling notes:
```

Do not put credentials, access tokens, unnecessary personal data, or confidential client information in repository records.

### Stage 1 gate

**GO to Stage 2 only if both are true:**

- at least **5 of 8** qualified interviewees independently describe prioritisation, actionability, or time-to-insight as a material recurring problem; and
- at least **3 of 8** currently pay for SEO tooling or paid SEO work/services.

Otherwise: **NO-GO**. Record the failed assumptions and return the evidence to ChatGPT through the bridge before changing segment, problem, or scope.

## 7. Stage 2 — two-cycle concierge pilot

### Pilot entry conditions

- Stage 1 passed and its evidence is recorded.
- At least five qualified users consent to a two-cycle pilot.
- Each supplies at least one suitable site with authorised GSC access.
- The operator understands that recommendations are evidence-backed hypotheses, not guaranteed outcomes.
- No credentials are collected in documents or messages; use the application's established Google/GSC access flow where possible.

### Minimum operational workflow

For each of at least five pilot users:

1. Assign a pseudonymous participant ID.
2. Confirm qualification, consent, site scope, and GSC authorisation.
3. Confirm the site's key/commercial pages with the operator; do not infer commercial relevance silently.
4. Run the existing TB-001 analysis for the authorised project.
5. Check the output for missing context, weak evidence, and obvious non-actionability.
6. Select no more than three current opportunities without inventing unsupported certainty.
7. Deliver a concise brief using the template below.
8. Capture useful/not useful, clarity, novelty, trust, rejection reason, and intended action.
9. If the operator acts, record exactly what they changed and the completion date.
10. Repeat the cycle one week later or at the agreed recurring interval.
11. Record whether the user returned without heavy chasing.
12. When a valid comparison window exists, capture the existing TB-001 outcome evidence and its limitations.
13. Complete the pilot scorecard and apply the gate mechanically.

Do not modify a customer's website, create content on their behalf, or claim causation from before/after movement.

### Concierge brief template

```text
TrendBrief cycle:
Participant/site ID:
Evidence window:
Generated/reviewed at:

Top actions (maximum three)

1. Page/query:
   What we observed:
   Supporting clicks/impressions/CTR/position evidence:
   Why it may matter:
   Recommended investigation/change:
   Commercial relevance: confirmed/unconfirmed, and by whom
   Confidence and limitations:
   Operator decision: accept/reject/defer
   Rejection/defer reason:

[Repeat only for actions 2 and 3]

Cycle feedback
- Relevant/useful: yes/no + reason
- Understandable without specialist explanation: yes/no + reason
- Would have found it independently: yes/no
- Intended/completed action:
- Estimated analysis time saved, with basis:
- Useful in a client conversation: yes/no + example
- Requested change:
```

### Per-user pilot scorecard

```text
Participant ID:
Qualified: yes/no
Cycle 1 delivered:
Cycle 2 delivered:
Action list relevant/useful: yes/no
Understandable without specialist explanation: yes/no
Implemented at least one action: yes/no + evidence
Returned/used cycle 2 without heavy chasing: yes/no
Meaningful time saving or client-management value: yes/no + evidence
Would use outcome evidence with a client: yes/no + evidence
Three-action limit helpful: yes/no + reason
Current detector commercially worthwhile: yes/no + rejection examples
Price tested: £19/£29 monthly
Paid or paid deposit/pre-order: yes/no + amount/date/reference
Safety/privacy incidents:
```

### Stage 2 gate

**GO to Stage 3 only if all are true:**

- **4/5** users rate the action list relevant/useful;
- **4/5** understand the recommendations without specialist explanation;
- **3/5** implement at least one suggested action;
- **3/5** return for or use cycle two without heavy chasing; and
- **3/5** report meaningful analysis-time saving or improved client/SEO management.

Otherwise: **NO-GO**. Do not compensate by building more features. Record failure reasons and return consequential changes to ChatGPT through the bridge.

## 8. Stage 3 — willingness to pay

Test one explicit recurring offer per prospect at **£19/month** or **£29/month**, selected before making the offer. State what the pilot includes and excludes. Do not treat a verbal expression of interest as payment evidence.

Accepted evidence:

- received payment for the recurring pilot; or
- received paid deposit/pre-order with amount, date, and transaction reference stored in an appropriate private operational record.

Do not store financial details in this public repository.

### Stage 3 gate

Before authorising a product implementation slice, require:

- at least **3 of 5** pilot users to pay or place a paid deposit/pre-order at the tested recurring price.

Strong support is **4/5** paying/pre-ordering and at least three users repeatedly completing recommendations.

If the gate fails, do not build TB-002. Return the evidence and unresolved decision to ChatGPT through the bridge.

## 9. Evidence handling and safety

- Use pseudonymous participant and site IDs in repository-safe summaries.
- Keep names, emails, client domains, GSC exports, payments, credentials, and raw interview recordings in an approved private operational location, not this public repository.
- Store only aggregated or redacted evidence in Git.
- Obtain permission before accessing each property or quoting a participant.
- Separate observed metrics from participant estimates and from TrendBrief interpretations.
- Record negative and rejected outputs; do not cherry-pick successful opportunities.
- Treat clicks, impressions, CTR, and position as evidence of movement, not proof TrendBrief caused it.
- Search Analytics may omit rows and anonymise queries; disclose incomplete evidence.

## 10. Gate review record

At each gate, create a dated, repository-safe summary containing:

```text
Stage:
Date:
Qualified sample size:
Each threshold numerator/denominator:
Observed evidence:
Failed or ambiguous assumptions:
Privacy-safe supporting references:
Decision: GO / NO-GO / WAITING FOR CHATGPT INPUT
Decision authority:
Next permitted action:
Explicitly prohibited next actions:
```

Neo may apply a threshold mechanically. Any proposal to change a threshold, customer segment, product promise, evidence source, price strategy, or MVP scope must return to ChatGPT through the bridge and, where required, Raj for approval.

## 11. Conditional MVP boundary

Only after all three gates pass may a TB-002 specification be proposed. The current conditional concept is:

> **TB-002: Multi-site prioritised action queue and opportunity detail surface for the validated GSC-first operator workflow.**

A later specification may include only what pilot evidence supports:

```text
sign in
→ select authorised project(s)
→ see the top three current actions
→ inspect evidence, limitations, and recommendation
→ accept/reject/complete
→ later inspect measured outcome
```

Before implementation, write acceptance criteria directly from pilot evidence and obtain the required approval. Passing this validation plan does not itself authorise implementation, deployment, pricing, or production data processing.

## 12. GO / NO-GO

**GO now:** conduct Stage 1 interviews and prepare eligible participants for the concierge pilot.

**NO-GO now:** TB-002, public UI, new detectors, paid data sources, product expansion, or production launch.

The next execution checkpoint is a completed Stage 1 gate record based on at least eight qualified interviews.
