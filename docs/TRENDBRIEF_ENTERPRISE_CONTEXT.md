# TrendBrief and Raj's operating estate

Status: **context only**. It adds no requirement, changes no scope and authorises no work. The relationship it describes was ratified by Raj on 2026-09-24.

Read it with [`TRENDBRIEF_PAUSE_CHECKPOINT_2026-09-03.md`](TRENDBRIEF_PAUSE_CHECKPOINT_2026-09-03.md). That checkpoint remains the durable handoff and the authority for what work is permitted next.

## How TrendBrief relates to the estate

- **TrendBrief is part of a private estate.** It's a product in Raj's private operating estate: a set of private core systems that hold shared architecture, governance and reusable patterns, used by several independent products.
- **It consumes what applies.** TrendBrief follows the estate's shared architecture, governance and patterns where they apply to it. That's conformance, not integration.
- **It's independently releasable.** TrendBrief has no runtime, code or data dependency on any other product, and none should be created. Standing decision 8, which keeps TrendBrief isolated, still holds.
- **Lessons arrive only as approved patterns.** A lesson learned in another estate application reaches TrendBrief only after the estate approves it as a shared pattern. Don't copy another product's code or architecture into this repository.
- **Unfinished estate work stays out of scope.** An estate capability that is planned, unfinished or still being designed never becomes a TrendBrief dependency or expands TrendBrief's scope automatically. TrendBrief doesn't wait for it.
- **Detail lives in the private estate.** Canonical estate implementation and governance detail is kept in the private estate, not in this public repository.

## Who decides what

| Concern                                                                                                                        | Authority                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Estate-level business direction and governance, shared architecture and patterns                                               | Raj's private operating estate                    |
| TrendBrief product and business decisions, domain behaviour, implementation, release sequencing and application-specific rules | **TrendBrief (this repository)**                  |
| OpenSEO platform foundation                                                                                                    | Upstream `every-app/open-seo`, consumed as a fork |

If an estate record and this repository disagree about a TrendBrief product matter, this repository's own records win.

## Scope protection

Nothing here changes the "next permitted work" in the pause checkpoint. A shared estate capability enters TrendBrief scope only through TrendBrief's own decision process.
