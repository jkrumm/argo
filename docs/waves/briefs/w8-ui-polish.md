Branch: fix/usage-v7-ui-polish
Title: fix(usage): v7 page polish from the live verification against the mocks
Owned files:
- apps/dashboard/src/features/usage-tracking/** (the Flow and Explore files, and the shared meters `limits.tsx` /
  CapMeter / SubscriptionMeter where item 5 needs them)
- apps/api/src/lib/usage-insights.ts and its test (item 1 only)

Task:
Argo (`~/SourceRoot/argo`; AGENTS.md, DESIGN.md, `.claude/rules/basalt-*.md` (law), `~/.claude/rules/frontend-routing.md`,
the installed basalt-ui `llms.txt`; `/basalt-design`, `/basalt-charts`). Spec `docs/design/usage-tracking.md` v7, mocks
`docs/design/usage-v7/flow-{light,dark,mobile-light,mobile-dark}.png`. The page is live (release 316ef3c8); a live
verification against the mocks found these, fix each:

1. **Literal backticks** in an insight sentence: "`me` carries every eval, `iu` every production call" renders the
   backticks. Templates in `lib/usage-insights.ts` must emit plain text (no markdown); test.
2. **Explore "Over time" drops today**: with Payer/Tool grouping over 7 d the chart ends ~1 Nov although
   `/api/usage/timeseries?groupBy=payer&range=7d` returns a 2026-11-02 bucket (iu-credit $65.8, me-credit $19.0), so the
   legend loses both credit payers. Find where the partial current day is dropped (over-time / over-time-model /
   explore-model) and keep it, marked partial if the v6 convention marks it; unit test.
3. **Athena "agw on this key since the cutover"** shows $42 in warn ink, "agw still bills this key", although the last
   agw row is 2 Nov 08:00 UTC, before agw finished moving to the gateway (the spec's A1 answer is "agw rows since
   08:05 UTC: 0"). Rule: warn ink and "still bills" only when an agw row is newer than 6 h; otherwise neutral:
   "last agw row {time} · nothing since" with the $ since the cutover as a quiet figure. Unit test in flow-model.
4. **Pace chart at 390**: "iu renews"/"me renews" labels overlap (~x=300) and "iu dry 3 Nov"/"me dry 4 Nov" clip to
   "iu dry"/"me dry". Stack or offset the labels so none overlap and the dates stay (basalt-charts rule).
5. **Meters' ink per the mock**: Subscriptions bars are amber at 84 %/95 %; the mock draws each bar in its payer's blue
   shade with status ink only on the % text. The IU personal key bar is fully red; the mock draws a grey bar with red
   only on the over-cap segment. Follow the mock ("ink earns its color", DESIGN.md), keeping the cap states of
   §Vocabulary in the text.
6. **Truncated fact label**: "CLAUDE ON IU SINCE THE C…" at 1440 and 390; shorten to the mock's "IU since the cutover"
   (or a wording that fits) so label and figure both show.
7. **Credit pool bars**: split "spent outside the gateway" from "through it" with a two-entry legend, as the mock does
   (pace's `outsideUsd` vs the rest of `spentUsd`).

Verify with `basalt-ui shot` rounds and the `basalt-design-reviewer` subagent at 1440 and 390, light and dark, on
`/usage-tracking` and `?node=pool:iu`, against the mocks (live data via the shot tool's approach per its skill; never
start Argo's dev server yourself).

Validation: `make check` (the gate; unit tests run with a 30 s timeout) and
`bun run test:api -- --timeout 30000 src/lib/usage-insights.test.ts src/routes/usage.insights.test.ts`.
Finish: commit per concern, push the branch (`git push -u origin fix/usage-v7-ui-polish`), open a ready (not draft) PR
(GitHub). Report the PR URL, the validation output verbatim, the shot paths and the reviewer's verdict.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why.
