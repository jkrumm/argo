# Warden — concept

Route `/warden` · `apps/dashboard/src/routes/warden.tsx`, `apps/dashboard/src/features/warden/` (`health-strip`, `stat-strip`, `decision-queues`, `board`, `pollers-list`, `status-chip`, `item-timeline`, `use-warden-actions`, `model.ts`, `page-model.ts`). API: `GET /warden/snapshot[?machine=]`; schema `warden_snapshots` (raw jsonb: health, metrics, board, budget, items).

## Baseline verdict

Shots: `warden--dark--desktop.png`, crops `warden--dark--01-card.png` … `-15-card.png`, `-03-verdicts-recorded.png`, `-04-fixes-vs-silence.png`, `-05-decision-wait-h.png`, `-06-unattended-fixes-wk.png`, `-07-poller-age-min.png`, `-08-reverts-reopens.png`.

- "Needs you {n}" is a table of {n} rows, each row with **four stacked buttons** (Implement, Dismiss, Re-investigate, Note). Title and decision text are both truncated mid-sentence; the question that matters is cut. Waiting time is the only figure and carries a one-hue colour.
- "Failed {n}" repeats the pattern with five buttons (adds Merge, Retry). The `WORK` flag is a pink chip with no explanation.
- The six funnel tiles (`03`–`08`) are the worst of the baseline: `{pct}%` over `windowed: false · numerator: {n} · denominator: {total} · it…` — a raw JSON key dump as a footer, truncated. "Poller age (min) {age}", "Reverts & reopens {n}" have no target, no unit meaning, no history. Dispatch budget is a plain sentence below.
- The lower half re-lists the same items six more times as stacked tables (Running, Merging & verifying, Needs decision, Failed, Deferred — budget, Working, Merging): the "Needs decision" items appear twice, the "Failed" ones twice. Deferred rows paint a whole column orange.
- Slop by verdict: stacked-button rows, bare-number tiles with a key dump, tables where a Board exists, every item shown twice.

**Distance from bar: 5.** The densest, most decision-heavy page, with the weakest expression; the decision card and board are Keel's strongest patterns and argo has neither.

## The question and the decision

Question: what is Warden waiting on me for, and is the loop healthy enough to leave alone?
Decision: for each needs-decision item, implement / dismiss / ask again; for each failure, retry / merge / drop.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Awaiting-owner items | `board.awaiting_owner[]` {event_id, repo, title, state, pr_url, age_days, reason, revision_count, redrives, availableActions}; `board.items[].availableActions` | Request needing a decision | Table + 4 buttons | Decision card: headline = `reason` as one question; facts `<repo> · waiting {age_days} d · revision {revision_count} · {redrives} redrives`; inset panel = full `reason` text (3-line clamp, expand on click); primary = first of `availableActions` by fixed priority (implement), secondary = `Dismiss`, quiet menu `Re-investigate · Note`. Age >2 d gets a text `status-warn` figure | One question, one primary; the verbs stay reachable | `decision-card--dark--desktop.png` |
| Failed items | `board.items` state `failed`, `failure_class` (infra / policy / work), `redrives`, `pr_url` | Request needing a decision | Table + 5 buttons + `WORK` chip | Same decision card, headline `Retry <title>?`, facts line leads with failure class as a status chip + `re-drive {redrives}` (`failure_class` is an open string: `work`, `infra`, `policy` today get fixed tones, any other value renders a neutral chip with the raw label; null renders no chip); primary `Retry`, secondary `Merge` when offered, quiet menu rest | Class is the cause, so it leads | `status-pill--dark--desktop.png` |
| Verdicts recorded | `metrics.verdicts_recorded_disposition` (fraction, numerator, denominator, windowed) | Progress to a target (one ratio) | `{pct}%` + key dump | Meter 0–100 %, value `{pct}` + muted `%`, caption `VERDICTS RECORDED · all time`, end captions `{n} of {total} items`; tooltip carries definition | Numerator/denominator become the caption, not a dump | `metric-card-bar--dark--desktop.png` |
| Fixes vs silence | `metrics.verified_fixes_vs_silence` {fixed, quiet, closed} | Part of a whole, 2–6 parts | `{pct}%` + key dump | Segmented Meter fixed / quiet / closed with counts; value `{pct} %` = fixed share of fixed+quiet | Three parts, one bar | `metric-card-bar--dark--desktop.png` |
| Decision wait | `metrics.median_needs_decision_to_decision_hours` (+ pairs, window_days) | Single value, threshold | `{hours}` | StatCard `{hours} h` median, qualifier `7 d · {n} pairs`, tick on a 0–24 h meter at 24 h | Unit and sample size make it interpretable | `metric-card--dark--desktop.png` |
| Unattended fixes | `metrics.verified_unattended_fixes_per_week` | Single value with a trend | `{n}` | StatCard `{n} fixes`, qualifier `last 7 d`, delta vs prior window when the snapshot history (7 d retained) has it, else em-dash with reason | Delta needs the comparison | `metric-card--dark--desktop.png` |
| Poller age | `metrics.poller_ages` / `health.pollers` | Status over time → liveness | `{age}` | Per-poller BarList rows (poller, bar on a 0–30 min scale, mono `{age} min`), the 30-min stale mark as a tick; summarised in the strip as `OLDEST POLLER {age} min` | Ranked list with a threshold | `stat-cell--dark--desktop.png` |
| Reverts & reopens | `metrics.reverts_and_reopens` {reverts, reopen_after_fixed} | Single value, status | `{n}` + dump | Strip cell `{n} reverts · {n} reopen`, text figures; `status-bad` text only when reverts >0 | Two counts, one cell, no dump | `stat-cell--dark--desktop.png` |
| Dispatch budget | `budget` {usedToday, max, implementToday, implementMax} | Progress to a target | Sentence | Two Meters (`DISPATCH`, `IMPLEMENT`) value `{used} / {max} today` with a tick at max; `status-warn` ink at ≥90 % | Budget is the second most-read number | `metric-card-bar--dark--desktop.png` |
| Board (all states) | `board.items`, `board.counts`, `terminal_24h` | Work items by status | 7 stacked tables | `Board`: columns New / Triaged / Working / Merging / Verifying / **Other**, each with count. **Assumption:** the column set mirrors warden's non-terminal vocabulary (`BUCKET_ORDER` in `model.ts`); `board.items[].state` is an open string, so any state outside that set lands in Other with its raw state as the card's status line, and every item appears exactly once. Needs-decision and Failed are NOT columns (they are the decision cards above); Deferred (`working` with a `deferred:` note, `isDeferredItem`) is a flagged card in Working. Card: repo + title (2-line clamp), origin glyph, age, PR link | Load per stage visible; removes the duplicates | `kanban-column--dark--desktop.png`, `kanban-card--dark--desktop.png` |
| Item timeline | `items[eventId]` transitions, dispatches, operations | Event sequence | Drawer | EventList (timeline density, rail) in the same drawer: day groups, `state → state` sentence, mono time | Already an event sequence | `timeline-event--dark--desktop.png` |

The `Needs you` and `Failed` cards come from the shared merged-inbox derivation (`apps/dashboard/src/lib/decisions.ts`, specified in `home.md`); this page uses its Warden subset (awaiting-owner + failed), with the board and metrics read directly from `lib/queries/warden`.

## Layout

1440:

1. Summary: `{n} items need you, oldest {age}. Loop healthy: poller {age} old, {n} fixes in 7 d.` Unhealthy: `Loop stalled — snapshot {age} old.`
2. Joined strip, 6 cells: Verdicts (meter) · Fixes vs silence (segments) · Decision wait · Unattended fixes · Poller age · Reverts & reopens; footer row = the two budget meters.
3. `Needs you {n}` — decision cards, 2 columns (each ~700 px); then `Failed {n}` the same.
4. `Board` — 5 state columns plus `Other` (hidden when empty), each scrolling alone.
5. Poller list as a collapsed `Pollers {n}` BarList below the board.

Stays: item-timeline drawer, `PageBar` sync, `StaleBanner` (as the loop-stalled summary variant). Changes: funnel, both queues, board. Goes: the six duplicate stacked tables, the dispatch-budget sentence, the key-dump footers.

390: strip is one column; decision cards one column with the inset panel collapsed behind a disclosure; board shows one column at a time under a SegmentedControl (SPEC §6.8).

## Copy

- Summary: `<n> items need you, oldest <age>. <loop-clause>.`
- Section titles: `Needs you <n>`, `Failed <n>`, `Board · <n> open`.
- Captions: `VERDICTS RECORDED · all time`, `FIXES VS SILENCE · all time`, `DECISION WAIT · 7 d median`, `UNATTENDED FIXES · 7 d`, `OLDEST POLLER`, `REVERTS · REOPENS`, `DISPATCH · today`, `IMPLEMENT · today`.
- Units: `h`, `min`, `fixes`, `%` muted after the figure.
- Decision card facts: `<repo> · waiting <n> d · revision <n> · <n> redrives`; actions `Implement`, `Dismiss`, menu `Re-investigate`, `Note`.
- Unavailable metric: `—` with qualifier `no data: <unavailable reason>`, never 0 or `n/a`.

## Upstream candidates

| Pattern | Props sketch | Maps to |
|-|-|-|
| `Board` | `Board {columns:[{key,label,count,totals}], cards, onOpen, compactSwitcher}` | SPEC §4 `Board` |
| Decision card (action-menu variant) | `DecisionCard {question, facts, evidence, primary, secondary, menu[]}` | SPEC §3 recipe; shared with agents |
| Strip footer meters | `StatGroup variant="strip" footer={Meter[]}` | SPEC §4 strip (footer row exists in §6.5) |
| Failure-class chip | `StatusChip {tone?, label}`; unknown label → neutral tone | New thin; SPEC §6.10 chip |

## Pass criteria

1. No row or card carries more than one primary and one secondary visible button; the rest are in one menu.
2. No tile footer shows a raw key (`windowed:`, `numerator:`); every metric has unit and period in caption.
3. Each item appears once on the page (needs-decision and failed are not repeated in the board; unknown states appear in `Other`).
4. The Fixes-vs-silence cell shows its three counts as segments summing to the total.
5. The budget is two meters with a max tick and `n / max` values.
6. A null metric renders `—` plus its reason, never `0` or `n/a`.
7. The board has per-column counts, an `Other` column when a state is outside the known set, and at 390 shows one column at a time.
8. Decision-card headlines are not truncated mid-sentence at 1440.

## Wave 19 rounds

Six shot rounds (`w19-warden-r1` … `r6`); r3 and r4 were scored by the `basalt-design-reviewer`, the rest are self-reads. The harness emits no `metrics.json`, so the reviewer fails every measured Craft item as unverifiable; verdicts below are about what the images show.

**r1 — self-read.** First full build. Defects: board columns clipped inside their scroll areas (long unbroken titles), Fixes caption truncated, two-line captions making strip cells uneven, deferred badge shrunk to `DE…`. Changed: board columns become a flex row (loaded columns share the width, empty ones shrink to a header), text wraps anywhere, captions shortened with the period moved to the qualifier line, deferred becomes an inline text flag.

**r2 — self-read.** Decision cards, strip and 390 layout hold. Defects: board header collision, Fixes counts wrapping, mobile board defaulting to an empty column. Changed: stacked column headers, mobile column store defaults to Working.

**r3 — reviewer: fail on every component, all on unmeasurable Craft items; visible defects:** board header row collided and a column clipped; mid-value truncation of a card ask line, the failed-card inset and a board title; decision-wait tick not at the 24 h mark; Fixes bar had no legend and its headline (fixed share of fixed + quiet) was not explained; Oldest poller had no visual; waits past 2 d carried no tone; failed cards repeated the title; mobile strip two columns; no definition tooltips. Pass criteria 1–4, 6, 8 passed, 5 unverified (budget absent live), 7 with a caveat. Changed: decision-wait meter runs 0–24 h with the tick at 24 h and warn ink past it; Oldest poller gets a 0–30 min meter with the stale tick; a wait past 2 d is warn text in the facts line; failed cards drop the actor line; fixed / quiet / closed legend in status ink; hover definitions on every strip caption.

**r4 — reviewer: same measured-item failures; previous visible defects verified fixed except the 390 strip.** Remaining: strip two columns at 390; budget cells read "no data" without an em dash; Fixes caption lacked its period. Changed: the strip is its own container and collapses to one column below 480 px; the budget empty state is `—` + `no data: budget not reported`; `all time` joins the Fixes qualifier. Wrapped legend text and the clamped inset stay (the text is warden's own).

**r5 / r6 — self-read.** 390 strip is one column; budget cells show the em dash and reason; light and dark hold. A last review pass was not re-run on r6 (diff vs r4 is the three items above).

**Keel read.** Against `root--dark--desktop` (Needs your call) and the record strip: the card anatomy matches (question, facts line, inset evidence, one filled primary, one subtle secondary, one quiet menu); the strip matches the joined cell + footer-row idea. Still short of Keel: no right-hand context preview on the cards (warden has no trend or draft to show), no confidence readout in the inset, board cards carry no column-level totals, and the day-grouped item-timeline event list was not built (the drawer is unchanged).

**Pass criteria (live snapshot):**

| # | Holds | Note |
|-|-|-|
| 1 | yes | one primary, one secondary, one menu per card |
| 2 | yes | no raw keys; every metric has unit and period |
| 3 | yes | needs-decision / failed / any `awaiting_owner` id are not board cards; unknown states go to Other (unit-tested; Other is empty live) |
| 4 | yes | fixed / quiet / closed segments sum to the total |
| 5 | by test | two meters with a max tick and `n / max today`, warn at 90 % (the 90 % threshold is unit-tested, the rendering is not); the live snapshot carries no budget, so the screenshots show the empty state |
| 6 | yes | null metric is `—` + `no data: <reason>` |
| 7 | yes | per-column counts, Other when needed, one column at a time at 390 (via the section tabs) |
| 8 | yes | headlines are whole sentences at 1440; a long first sentence wraps, never cut |

Deviations from the concept: the card headline is the first sentence of warden's decision text with the rest as the inset (the concept's "inset = full reason" would repeat the headline); the 390 board switcher is `ViewTabs` in the `Section` tabs slot (basalt's lint rejects a raw `SegmentedControl`) and renders as a select; the Unattended-fixes delta is always `—` (no snapshot-history query exists); relative times on board cards come from basalt's `relativeTime` and follow the browser locale.

### Upstream (as built)

- `apps/dashboard/src/components/upstream/decision-card.tsx` (shared with Agents, PR #62): `DecisionCardProps { question: string; facts: readonly (string | { text: string; tone: 'warn' | 'bad' })[]; status?: ReactNode; actor?: ReactNode; evidence?: ReactNode; preview?: ReactNode; primary?: Action; secondary?: Action; menu?: readonly Action[]; disclosure?: { label: string; content: ReactNode }; meta?: ReactNode }`, `Action = { label; key?; onClick; loading?; disabled?; icon? }`.
- `features/warden/stat-strip.tsx`: `StatStrip { cells: { key; caption; info?; value: string; unit?; valueColor?; qualifier?: ReactNode; visual?: ReactNode }[]; footer?: { key; content: ReactNode }[] }`.
- `features/warden/board.tsx`: `Board { columns: { key; label; items }[]; onSelectItem(eventId) }` plus `board-store.ts` (the mobile column field).
- `features/warden/status-chip.tsx`: `StatusChip { tone: 'work' | 'infra' | 'policy' | 'neutral'; label }`.

### basalt friction

- `Meter` has one `target` tick: the decision-wait and poller meters need only one, but a budget meter wants a max tick plus an overage region; the track is stretched to 125 % of the cap so the tick sits inside it.
- `BarList` has no per-row stale tick: the poller list states the 30 min mark in the secondary column instead.
- `ViewTabs` in `Section.tabs` folds to a select at 390; a segmented row per column (with counts) would read better for a board.
- `Section.tabs` cannot be conditional without a hoisted ternary (the lint reads the slot); the board passes `undefined` at desktop.
- `relativeTime` ignores the app's English UI (German strings on an English page).
