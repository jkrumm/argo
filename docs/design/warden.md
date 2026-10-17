# Warden — concept

Route `/warden` · `apps/dashboard/src/routes/warden.tsx`, `apps/dashboard/src/features/warden/` (`awaiting-owner-section`, `funnel-stats`, `issues-section`, `board-section`, `item-timeline`, `use-warden-actions`, `model.ts`). API: `GET /warden/snapshot[?machine=]`; schema `warden_snapshots` (raw jsonb: health, metrics, board, budget, items).

## Baseline verdict

Shots: `warden--dark--desktop.png`, crops `warden--dark--01-card.png` … `-15-card.png`, `-03-verdicts-recorded.png`, `-04-fixes-vs-silence.png`, `-05-decision-wait-h.png`, `-06-unattended-fixes-wk.png`, `-07-poller-age-min.png`, `-08-reverts-reopens.png`.

- "Needs you 6" is a six-row table, each row with **four stacked buttons** (Implement, Dismiss, Re-investigate, Note). Title and decision text are both truncated mid-sentence; the question that matters is cut. Waiting time is the only figure and carries a one-hue colour.
- "Failed 3" repeats the pattern with five buttons (adds Merge, Retry). The `WORK` flag is a pink chip with no explanation.
- The six funnel tiles (`03`–`08`) are the worst of the baseline: `75%` over `windowed: false · numerator: 268 · denominator: 357 · it…` — a raw JSON key dump as a footer, truncated. "Poller age (min) 17.1", "Reverts & reopens 0" have no target, no unit meaning, no history. Dispatch budget is a plain sentence below.
- The lower half re-lists the same items six more times as stacked tables (Running, Merging & verifying, Needs decision, Failed, Deferred — budget, Working, Merging): the six "Needs decision" items appear twice, three "Failed" twice. Deferred rows paint a whole column orange.
- Slop by verdict: stacked-button rows, bare-number tiles with a key dump, tables where a Board exists, every item shown twice.

**Distance from bar: 5.** The densest, most decision-heavy page, with the weakest expression; the decision card and board are Keel's strongest patterns and argo has neither.

## The question and the decision

Question: what is Warden waiting on me for, and is the loop healthy enough to leave alone?
Decision: for each needs-decision item, implement / dismiss / ask again; for each failure, retry / merge / drop.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Awaiting-owner items | `board.awaiting_owner[]` {event_id, repo, title, state, pr_url, age_days, reason, revision_count, redrives, availableActions}; `board.items[].availableActions` | Request needing a decision | Table + 4 buttons | Decision card: headline = `reason` as one question; facts `<repo> · waiting 3.4 d · revision 3 · 2 redrives`; inset panel = full `reason` text (3-line clamp, expand on click); primary = first of `availableActions` by fixed priority (implement), secondary = `Dismiss`, quiet menu `Re-investigate · Note`. Age >2 d gets a text `status-warn` figure | One question, one primary; the verbs stay reachable | `decision-card--dark--desktop.png` |
| Failed items | `board.items` state `failed`, `failure_class` (infra / policy / work), `redrives`, `pr_url` | Request needing a decision | Table + 5 buttons + `WORK` chip | Same decision card, headline `Retry <title>?`, facts line leads with failure class as a status chip (`work`, `infra`, `policy`) + `re-drive 2`; primary `Retry`, secondary `Merge` when offered, quiet menu rest | Class is the cause, so it leads | `status-pill--dark--desktop.png` |
| Verdicts recorded | `metrics.verdicts_recorded_disposition` (fraction, numerator, denominator, windowed) | Progress to a target (one ratio) | `75%` + key dump | Meter 0–100 %, value `75` + muted `%`, caption `VERDICTS RECORDED · all time`, end captions `268 of 357 items`; tooltip carries definition | Numerator/denominator become the caption, not a dump | `metric-card-bar--dark--desktop.png` |
| Fixes vs silence | `metrics.verified_fixes_vs_silence` {fixed 34, quiet 23, closed 294} | Part of a whole, 2–6 parts | `60%` + key dump | Segmented Meter fixed / quiet / closed with counts; value `60 %` = fixed share of fixed+quiet | Three parts, one bar | `metric-card-bar--dark--desktop.png` |
| Decision wait | `metrics.median_needs_decision_to_decision_hours` (+ pairs, window_days) | Single value, threshold | `0.5` | StatCard `0.5 h` median, qualifier `7 d · 39 pairs`, tick on a 0–24 h meter at 24 h | Unit and sample size make it interpretable | `metric-card--dark--desktop.png` |
| Unattended fixes | `metrics.verified_unattended_fixes_per_week` | Single value with a trend | `26` | StatCard `26 fixes`, qualifier `last 7 d`, delta vs prior window when the snapshot history (7 d retained) has it, else em-dash with reason | Delta needs the comparison | `metric-card--dark--desktop.png` |
| Poller age | `metrics.poller_ages` / `health.pollers` | Status over time → liveness | `17.1` | Per-poller BarList rows (poller, bar on a 0–30 min scale, mono `17 min`), the 30-min stale mark as a tick; summarised in the strip as `OLDEST POLLER 17 min` | Ranked list with a threshold | `stat-cell--dark--desktop.png` |
| Reverts & reopens | `metrics.reverts_and_reopens` {reverts 0, reopen_after_fixed 1} | Single value, status | `0` + dump | Strip cell `0 reverts · 1 reopen`, text figures; `status-bad` text only when reverts >0 | Two counts, one cell, no dump | `stat-cell--dark--desktop.png` |
| Dispatch budget | `budget` {usedToday, max, implementToday, implementMax} | Progress to a target | Sentence | Two Meters (`DISPATCH`, `IMPLEMENT`) value `12 / 20 today` with a tick at max; `status-warn` ink at ≥90 % | Budget is the second most-read number | `metric-card-bar--dark--desktop.png` |
| Board (all states) | `board.items`, `board.counts`, `terminal_24h` | Work items by status | 7 stacked tables | `Board`: columns New / Triaged / Working / Merging / Verifying with count; Needs-decision and Failed are NOT columns (they are the decision cards above); Deferred is a flagged card variant in Working, not a column. Card: repo + title (2-line clamp), origin glyph, age, PR link | Load per stage visible; removes the duplicates | `kanban-column--dark--desktop.png`, `kanban-card--dark--desktop.png` |
| Item timeline | `items[eventId]` transitions, dispatches, operations | Event sequence | Drawer | EventList (timeline density, rail) in the same drawer: day groups, `state → state` sentence, mono time | Already an event sequence | `timeline-event--dark--desktop.png` |

## Layout

1440:
1. Summary: `3 items need you, oldest 3.4 d. Loop healthy: poller 17 min old, 26 fixes in 7 d.` Unhealthy: `Loop stalled — snapshot 42 min old.`
2. Joined strip, 6 cells: Verdicts (meter) · Fixes vs silence (segments) · Decision wait · Unattended fixes · Poller age · Reverts & reopens; footer row = the two budget meters.
3. `Needs you 6` — decision cards, 2 columns (each ~700 px); then `Failed 3` the same.
4. `Board` — 5 columns, each scrolling alone.
5. Poller list as a collapsed `Pollers 4` BarList below the board.

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
| Failure-class chip | `StatusChip {tone, label}` by class | New thin; SPEC §6.10 chip |

## Pass criteria

1. No row or card carries more than one primary and one secondary visible button; the rest are in one menu.
2. No tile footer shows a raw key (`windowed:`, `numerator:`); every metric has unit and period in caption.
3. Each item appears once on the page (needs-decision and failed are not repeated in the board).
4. The Fixes-vs-silence cell shows its three counts as segments summing to the total.
5. The budget is two meters with a max tick and `n / max` values.
6. A null metric renders `—` plus its reason, never `0` or `n/a`.
7. The board has per-column counts and at 390 shows one column at a time.
8. Decision-card headlines are not truncated mid-sentence at 1440.
