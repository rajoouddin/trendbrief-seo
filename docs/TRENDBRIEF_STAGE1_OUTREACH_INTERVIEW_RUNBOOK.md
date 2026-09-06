# TrendBrief Stage 1 outreach and interview runbook

Status: **ACTIVE — CUSTOMER-PROBLEM RESEARCH ONLY**

Authority: `docs/TRENDBRIEF_MVP_VALIDATION_PLAN.md`

This runbook operationalises Stage 1. It does not change the approved segment, hypothesis, thresholds, or product scope. It does not authorise TB-002, a product build, or the concierge pilot.

## 1. Exact qualification criteria

Count an interview toward the Stage 1 gate only when the participant:

- is a freelance web/marketing consultant or works in a micro-agency;
- manages approximately 3–20 active SMB websites;
- personally owns or materially influences recurring SEO decisions;
- has access to, or regularly works with, Google Search Console data; and
- is not employed primarily as a dedicated SEO analyst.

Public research establishes only **plausibility**. Confirm every criterion during the conversation. Record near-misses separately and do not count them toward the eight qualified interviews.

## 2. Data boundary

The TrendBrief repository is public. Use only pseudonymous IDs such as `TB-P001` in repository records.

Keep the following outside the repository:

- names and direct identifiers;
- business names where they identify the participant;
- email addresses, phone numbers, social-profile URLs, and contact-form URLs;
- client names/domains;
- raw recordings or transcripts;
- credentials, GSC data, payment details, or confidential business information.

The public tracker may contain a general source category, non-identifying plausibility evidence, qualification state, interview state, and a private-record reference. Capture only the minimum contact information needed for outreach in the private register.

## 3. Pipeline workflow

Use `docs/TRENDBRIEF_STAGE1_PROSPECT_PIPELINE.csv` for repository-safe state and the private prospect register named in its header for identities and public source/contact URLs.

Allowed pipeline states:

```text
researched
ready_for_outreach
connection_request_sent
outreach_sent
follow_up_sent
responded
interview_scheduled
interview_completed
closed_no_response
closed_declined
closed_not_qualified
```

`connection_request_sent` applies only to a social-platform connection/follow request (for example, a LinkedIn connection request) sent before the actual interview ask. Do not record `outreach_sent` until the interview request itself — the message asking for 15–20 minutes — has actually been delivered (by DM after acceptance, by email, or by contact form). A prospect can sit in `connection_request_sent` for some time while awaiting acceptance; that is not the same state as `outreach_sent`.

Allowed qualification states:

```text
unverified
qualified
not_qualified
near_miss
```

For each prospect:

1. Review the public evidence in the private register.
2. Mark only `appears_plausible`; never pre-qualify from an agency label alone.
3. Select the least intrusive public contact route.
4. Personalise one sentence using genuine public context.
5. Send one concise request and record the outreach date.
6. If there is no response, send at most one polite follow-up after 5–7 days.
7. If they respond, confirm fit lightly and schedule a 15–20 minute conversation.
8. After the interview, update both the private record and anonymised public state.

Do not scrape private contact details, buy lists, mass-message, or post where community rules prohibit research requests.

## 4. Outreach variants

Replace bracketed fields. Do not include the proposed solution or ask whether TrendBrief sounds useful.

### LinkedIn direct message

> Hi [first name] — I’m researching how independent web/marketing consultants and small agencies decide which SEO work deserves attention across multiple client sites. Your work with [specific public context] looked relevant. Would you be open to a 15–20 minute research conversation about your current process, tools, and what tends to get delayed? This is discovery rather than a sales demo. Happy to work around your schedule.

### Email

**Subject:** Short research conversation about multi-site SEO prioritisation

> Hi [first name],
>
> I’m researching how freelance consultants and very small agencies decide what SEO work to prioritise across client websites.
>
> I found your work through [specific public source/context]. I’d value 15–20 minutes to understand your current process: what data and tools you use, how you choose the next task, and what tends to be delayed or ignored.
>
> This is a research conversation, not a product demo or detailed sales pitch. Would you be willing to speak on [two concrete options], or suggest a more convenient time?
>
> Thanks,
> Raj

### Professional community post or direct request

Use only where the community permits research requests.

> I’m looking to speak with freelance web/marketing consultants or very small agencies that manage SEO decisions across roughly 3–20 SMB client websites. I’m researching the current workflow—how people decide what deserves attention, which tools they use, and what gets delayed—not pitching a finished product. If that describes your work and you are open to a 15–20 minute conversation, please reply or message me. I will not share identifying comments without permission.

### Existing contact or referral

> Hi [first name] — I’m researching how consultants and small agencies prioritise recurring SEO work across several client sites. You came to mind because [real relationship/context]. Could I ask you about your current process for 15–20 minutes? I’m looking for concrete recent examples rather than feedback on a product. If you are not the right person, is there one independent consultant or small-agency operator you would feel comfortable introducing?

### Single follow-up

> Hi [first name] — one brief follow-up in case this was buried. I’m still looking for 15–20 minutes to understand how consultants/small agencies currently prioritise SEO work across client sites. No problem if the timing or topic is not a fit; I won’t chase again.

## 5. Scheduling and consent preface

Before scheduling, say the conversation is research, approximately 15–20 minutes, and not a sales demo. Do not imply compensation unless Raj has explicitly offered it.

At the start of the interview:

> Thanks for speaking with me. I’m researching your current behaviour and problems, not testing you. I’ll take notes so I can compare patterns across interviews. I will keep repository records anonymised and will not attribute quotes to you without permission. Please avoid sharing client-confidential information. Is that okay?

If recording is desired, request explicit recording consent separately. No consent means notes only.

## 6. Consistent 15–20 minute interview checklist

### Before the call

- [ ] Assign the pseudonymous participant ID.
- [ ] Confirm the private identity-to-ID record exists.
- [ ] Review plausibility evidence; do not assume qualification.
- [ ] Prepare a timer and private notes location.
- [ ] Do not prepare or show a product demo.

### Opening and role — about 2 minutes

- [ ] Deliver the consent preface.
- [ ] Ask: “Tell me about the websites you manage and what clients expect from you.”
- [ ] Confirm number/type of active SMB sites and the participant’s decision authority.
- [ ] Confirm whether they personally use or work with GSC.
- [ ] Confirm they are not primarily a dedicated SEO analyst.

Stop counting the interview toward the gate if qualification fails, but retain useful near-miss evidence separately.

### Recent behaviour — about 7 minutes

Ask for concrete recent examples before opinions:

1. “When did you last decide what SEO work to do next? Walk me through it.”
2. “Which data and tools did you use, and how long did the work take?”
3. “What makes prioritisation difficult across your sites?”
4. “What SEO work gets delayed or ignored, and why?”
5. “How do you decide whether a page is worth improving?”

Useful probes:

- “What happened the last time?”
- “How often does that occur?”
- “Show me the sequence, not the ideal process.”
- “Who else is involved?”
- “What do you do when time runs out?”
- “What does that cost in time, money, delay, or client trust?”

### Workarounds, payment, and accountability — about 5 minutes

6. “What do clients ask you to show about work completed or results?”
7. “Which SEO tools or services do you pay for today, and what job earns that spend?”
8. “Describe a recent recommendation you acted on. What happened next?”
9. “What would make a prioritised action untrustworthy or unusable?”

Clarify:

- current workaround and why it persists;
- review frequency;
- time spent per site or cycle;
- work abandoned or deferred;
- who bears the consequence;
- whether the participant has tried to change the process.

### Hypothesis reaction — only after discovery, about 3 minutes

Give only this neutral description:

> One hypothesis we may test is a short, evidence-backed list of no more than three actions from existing Search Console data, with a record of what was done and what happened later.

Then ask:

- “How would this fit or fail to fit your current workflow?”
- “Which part would save time, if any?”
- “What evidence would you need before acting?”
- “Would three actions feel focused or insufficient? Why?”

Treat the answers as reactions, not proof of demand.

### Close — about 2 minutes

- [ ] Ask whether they would consider a later two-cycle pilot using an authorised suitable site.
- [ ] Ask permission before retaining any exact quote.
- [ ] Ask whether one relevant peer might be willing to speak.
- [ ] Explain that participation does not commit them to a product or purchase.

## 7. Evidence record after each interview

Update the private interview record immediately. Add only anonymised state and aggregate-safe notes to the repository.

Classify evidence explicitly:

| Evidence class        | What counts                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Observed behaviour    | A concrete recent action, workflow, tool use, or artefact the participant describes or shows.        |
| Stated pain           | Their own description of difficulty or dissatisfaction.                                              |
| Existing workaround   | The actual method/tool/person currently used.                                                        |
| Time/cost consequence | A concrete duration, spend, missed task, delay, or client consequence; label estimates as estimates. |
| Willingness to change | Prior attempts, active search, switching behaviour, or commitment of time/data.                      |
| Pilot willingness     | Agreement to a defined follow-up pilot; not payment evidence.                                        |

Private interview template:

```text
Participant ID:
Interview date:
Qualification: qualified / not_qualified / near_miss
Qualification evidence for each of the five criteria:
Sites managed and types:
Role and SEO decision authority:
GSC access/use:
Current SEO review frequency:
Concrete most-recent workflow:
Current tools/workarounds:
Current paid SEO tools/services:
Recurring problem described unprompted: yes/no + exact evidence
Material consequence/time cost:
Work ignored/delayed:
Client reporting/accountability need:
Evidence needed to trust an action:
Prior attempts/willingness to change:
Three-action reaction (post-discovery only):
Pilot willingness:
Exact approved quotes:
Contradictory evidence:
Suggested different hypothesis (evidence only; no scope change):
Researcher interpretation, clearly labelled:
Consent/data-handling notes:
Private supporting references:
```

Do not record “sounds useful”, “good idea”, or hypothetical usage as validation.

## 8. Pattern tracking and decision boundary

Do not redesign the product after an individual interview. Update aggregate counts only from completed qualified interviews.

The exact Stage 1 gate is:

- at least **5 of 8** qualified interviewees independently describe prioritisation, actionability, or time-to-insight as a material recurring problem; and
- at least **3 of 8** currently pay for SEO tooling or paid SEO work/services.

At eight completed qualified interviews, stop Stage 1 outreach analysis and prepare the bridge evidence package required by the authoritative plan. Do not begin the concierge pilot or TB-002 automatically.
