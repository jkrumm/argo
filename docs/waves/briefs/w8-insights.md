Branch: feat/usage-v7-insights
Title: feat(usage): GET /usage/insights, rule-based observations under the verdict
Owned files:
- apps/api/src/lib/usage-insights.ts (new), apps/api/src/lib/usage-insights.test.ts (new)
- apps/api/src/routes/usage-insights.ts (new), apps/api/src/routes/usage.insights.test.ts (new)
- apps/api/src/routes/usage-pace.ts, usage-router.ts, usage-demand.ts, usage-portal.ts: refactor only, to export the
  loader each handler already runs (e.g. `loadPace(now)`, `loadRouter(range)`, `loadDemand(params)`), behaviour unchanged
- apps/api/src/routes/usage.ts: only the import and one `.use(usageInsightsRoutes)` line
- apps/api/src/test/usage-seed.ts: additive helpers only

Task:
Argo (`~/SourceRoot/argo`; read AGENTS.md, apps/api/AGENTS.md §Usage page data, apps/api/.claude/rules/*.md). Spec
`docs/design/usage-tracking.md` v7, read §Insights in full, plus §The headline and §Endpoints. `/usage/pace`,
`/usage/router`, `/usage/demand` and `/usage/iu-budget` (with `underCapOn`) are on master: read their code first.

`GET /usage/insights?period=7d|30d` (default 7d). Facts by rules, never by a model. No `agw digest` in this change:
every sentence is a template filled from the facts (the spec allows that; the wording hook can come later).

Response, exactly (zod, every field `.describe()`d per apps/api/.claude/rules/openapi.md):
```ts
{
  asOf: string; period: '7d' | '30d'
  items: {
    id: string            // detector id, e.g. 'top-share', 'mover', 'cost-per-run', 'pool-split', 'claude-on-iu', 'cache-drop', 'cap-near'
    rank: number          // 1 = first; ranked by usdMoved desc, ties by id
    node: string          // the Flow node it is about: 'pool:iu', 'sub:me', 'key:personal', 'key:athena-team', 'router', 'demand:<workflow>'
    sentence: string      // template sentence; every number in it comes from facts
    facts: Record<string, number | string | null>
    usdMoved: number      // the money the observation is about, for ranking
    thin: boolean         // built on under 24 h of data (pace's thin, or a period shorter than its window)
  }[]                     // 0..5 items; empty = the view shows "nothing stands out"
}
```
Detectors (each a pure function in `lib/usage-insights.ts` over the loaders' outputs, firing only past its threshold;
document each threshold in a comment and in the route description):
1. `top-share`: the workflow with the biggest share of production credit spend in the period, fires at ≥ 50 %
   ("review is 98 % of production credit").
2. `mover`: the workflow whose spend changed most against the previous equal period, fires at ≥ $5 and ≥ 30 %.
3. `cost-per-run`: a workflow whose cost per run changed ≥ 30 % against the previous period with ≥ 5 runs in each
   ("the cost per review fell from $0.78 to $0.16").
4. `pool-split`: one pool carries ≥ 90 % of eval spend and another ≥ 90 % of production spend
   ("`me` carries every eval, `iu` every production call").
5. `claude-on-iu`: Claude work on IU in the period (pace's clause / router's iu causes `claude-code`, `credit-fallback`,
   `route-fallback`): above $1 it fires as a warning; at $0 with gateway traffic in the period it fires as the
   reassurance "no Claude work fell back to IU" with usdMoved 0 (so it ranks last).
6. `cache-drop`: a caller × target whose hit rate fell ≥ 15 points against the previous period on ≥ 50 requests.
7. `cap-near`: an IU key at ≥ 80 % of its cap: "the Athena key has $35 of headroom until 12 Nov" (headroom = cap −
   rolling 30 d; the date is `underCapOn` when set). Athena appears only in its own sentence, never summed with ours.
Money formatting follows §Carried from v6 › Vocabulary (whole dollars below $1,000, cents only under $10, `<$1`).
Return the top 5. Every loader is already guarded; an unreadable source makes its detectors not fire, never a 500.

Tests: each detector fires and does not fire around its threshold (pure tests), the ranking, the 5 cap, the empty
case, and one route test over seeded rows. Report the live output (`period=7d`) as seen through the route test
harness or a read-only query, so the lead can check the sentences against the spec's examples.

Validation: `bun run test:api -- src/lib/usage-insights.test.ts src/routes/usage.insights.test.ts src/routes/usage.pace.test.ts src/routes/usage.router.test.ts src/routes/usage.demand.test.ts src/routes/usage.portal.test.ts`
and `bun --cwd apps/api typecheck` and `bun run lint` and `bun run format:check`.
Finish: commit, push the branch (`git push -u origin feat/usage-v7-insights`), open a ready (not draft) PR (GitHub).
Report the PR URL and the validation output verbatim.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why. No dev servers.
