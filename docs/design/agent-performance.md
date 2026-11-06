# Agent performance — concept

Route `/agent-performance` · `apps/dashboard/src/routes/agent-performance.tsx`, `apps/dashboard/src/features/agent-performance/` (`agent-performance-page`, `review-section`, `issues-section`, `subagents-section`, `runs-section`, `colors.ts`, `model.ts`). API: `GET /agents/kpis/usage?weeks=`, `GET /agents/review-stats`. Nav: System, right after Agents. No baseline shot: the page is new (built before its endpoints were deployed, so it has not been shot against production).

## The question and the decision

Question: are the agents earning their cost, and is review quality holding? Where does an Issue's money go?
Decision: retune a subagent or prompt, or move a lane to a cheaper tier; otherwise nothing, and leave.

## Datasets and encodings

| Dataset | Source | Encoding |
|-|-|-|
| Reviews per week by tier | `GET /agents/review-stats` `snapshot.weeks[].groups[]` (`agw review stats --bucket week --by tier`, pushed by agent-workflows) | Stacked plain bars, jobs per ISO week, light / standard / deep as three accent shades (deep darkest). Missing weeks are zero jobs |
| Quality by tier | the same, summed over the window | Table per tier: jobs, clean first rounds (`52%` over `51 of 98 first rounds`), precision for important findings and nits (`—` when null, `of n judged` under it) |
| Reviews by prompt | `snapshot.byPrompt[]` (`agw review stats --by prompt`, all weeks pushed) | Same columns per fingerprint, shortened to 10 characters, full key on hover |
| Cost per Issue | `usage.issues[]` | One row per Issue, newest first: `#<n> <repo>`, span, runs, cost; a segmented `Meter` of its lanes by cost; lane breakdown (runs, requests, cost) in the row's disclosure; top 10, then `Show n more` |
| Subagents and workers | `usage.subagents[]` | Two ranked `BarList` groups (subagents, factory workers) by cost; secondary text `runs · requests · avg per run` |
| Runs per week by type | `usage.byWeek[]` | Stacked plain bars, top 5 types by total runs on the rank ladder, `(other)` the last grey |

Precision is the pooled acted-on share: each group's `precision` weighted by its judged findings (fixed + wrong + irrelevant: agw's own denominator, `intentional` and `open` are not judged). Lane mapping for the Issue bar: `lead` is the lead session; subagent or worker names containing `implement`, `review`, `verif` are implementer, reviewer, verifier (`review` wins over `verif`); `Explore` is Explore; everything else is other. Colours live in `colors.ts` on the `USAGE_RANK` series ladder (accent shades two steps apart, then greys); no purple, no heatmaps.

Cost is `cost_usd` at list value: Max subscription rows are not billed money. The caveat on screen is the API's own `costBasis` string, never reworded.

## Layout

1440, top to bottom: page bar with the `weeks` control (4 / 8 / 12, default 8, URL only) and refresh; summary sentence (`Last 8 weeks: {n} subagent runs and {n} factory worker runs, {usd} at list value. {n} review jobs, {pct} clean in the first round.`); then four sections, each closing with a muted source line: Reviews (chart, tier table, prompt table), Cost per Issue, Subagents and workers, Runs per week by type.

390: sections stack as at 1440; tables fold their lowest-priority columns into the row disclosure (`BasaltDataTable`); the lane legend wraps; charts keep their week axis.

## States

- Review stats not pushed (`latest` null, or `?shot-state=empty`): the Reviews section shows `agw has not pushed weekly review stats yet` and its source line says `not pushed yet`; the summary says so too. Never zeros. The other sections do not depend on it.
- Review stats pushed with no jobs in the window: `No review jobs in this window`.
- Loading and error are each section's own (`Section query`).
