# Body Composition — concept

Route `/body-composition` · `apps/dashboard/src/routes/body-composition.tsx`, `apps/dashboard/src/features/body-composition/` (`components/weight-panel.tsx`, `skinfold-panel.tsx`, `charts/`, `formulas.ts`).

## Baseline verdict

Baseline: `.design-shots/baseline/body-composition--dark--desktop.png`, crops `body-composition--dark--01-card.png` (weight KPI row), `02-body-weight.png`, `03-card.png` (skinfold KPI row), `04-skinfold-belly-fat.png`, `05-card.png` (skinfold table). Production data, 2026-10-17, 90d window.

- **Slop.** Two rows of six same-size tiles (`01-card`, `03-card`): "Current {weight} kg", "7d avg {avg_short}", "30d avg {avg_long}", "Weekly Δ {weekly_delta}", "Monthly Δ {monthly_delta}", "kg / week {rate}". Five of them are bare numbers with no scale and no history; "Weekly Δ" and "Monthly Δ" carry a green or amber colour whose direction is not explained (a gain is amber, a loss green, regardless of the goal). The "{intensity}" badge is the only interpretation on the page and it sits in a tile corner.
- **Skinfold half is dead space.** `03-card` is six "—" tiles, `04-skinfold-belly-fat` is a 420 px empty chart saying "No readings yet — log your first caliper session", `05-card` an empty table. Roughly 45 % of the page height shows nothing.
- **Forms are as tall as the data.** "Log Weight" and "Log Skinfold" are full-width cards with two oversized date/number inputs and a Save button, one above each chart.
- **Filler subtitles:** "Am I trending toward my goal?" (shown twice, once on the section and once in the chart card) and "Am I trending leaner?" (twice).
- **Chart data stops early.** The weight line in `02` ends well before the end of the 90-day window; the page never says the last entry is old.
- **Distance from bar: 4/5.** One real chart (weight line + 7d average is the right shape), everything around it is a row of tiles, forms and empty states.

## The question and the decision

- **Question on opening:** where is my weight going against the goal, how fast, and is my waist getting leaner?
- **Decision:** eat more or less this week (adjust the surplus/deficit), and whether to take a caliper session now.

## Datasets and encodings

| Dataset                | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Shape (SPEC §3)                   | Today                                    | Chosen encoding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Reason                                                                                                                          | Keel pattern                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Current weight vs goal | `GET /weight-log/summary` · `current`; goal from `GET /user-profile` · `goal_weight_kg` (snake_case on the wire; nullable). **No-goal state:** with `goal_weight_kg` = null the hero cell shows value, delta and 7 d / 30 d means only, with no meter, no goal tick and no chart refLine; the footer carries one action "Set a goal" that opens the profile weight field (`PUT /user-profile`), and the summary sentence drops the distance-to-goal clause | Progress to a target              | Tile "{weight} kg" + badge               | Hero cell: "{weight}" + muted "kg", delta text "{delta} kg vs 30 d", `Meter` bar from start-of-window weight to goal weight with a tick at the goal and end captions "{start_weight} kg" "{goal_kg} kg goal"; caption "WEIGHT · latest {date}"; qualifier "goal {goal_kg}"                                                                                                                                                                                                                                                                                                                                                                                                                                               | The goal exists in the profile but is never shown; progress to a target is a meter with the target tick                         | `metric-card-bar`                |
| Rolling averages       | `/weight-log/summary` · `ma7`, `ma30`, `trend`                                                                                                                                                                                                                                                                                                                                                                                                             | Single value with a trend         | Two bare tiles                           | Merged into the weight chart's legend and the hero cell's footer: "7 d mean {avg_short} · 30 d mean {avg_long} kg"; the dashed line on the chart is the trailing 7 d mean (entries 0 to 7 days up to each date), the same helper and constant as the header's and the cell's "7 d mean"; where the 7 d window is under-covered (under 70 % of the period) the line has a gap and the header says `—`                                                                                                                                                                                                                                                                                                                     | An average is a line on the chart, not a tile                                                                                   | `stat-cell`                      |
| Rate of change         | `/weight-log/summary` · `weeklyDelta`, `monthlyDelta`, `kgPerWeek`, `phase` (`losing`, `gaining`, `maintaining`), `intensity`                                                                                                                                                                                                                                                                                                                              | Single value with a trend         | Three tiles, coloured by sign            | One strip cell "RATE": "{rate} kg/wk" with `DeltaBadge`-style text delta, a pill with the API's `intensity` string ("{intensity}"), which the page shows verbatim: `phase` only picks the pill tone via the existing `weightPhaseColor` (`losing` blue, `gaining` yellow, `maintaining` gray); the tiers behind `intensity` are Maintenance (abs rate < 0.1 kg/wk), Lean/Standard/Aggressive cut (< 0.4, < 0.8, ≥ 0.8) and Lean/Standard/Aggressive bulk (< 0.3, < 0.6, ≥ 0.6), and a `Meter` band −0.5…+0.5 kg/wk with neutral zone ±0.1, marker at the current rate; qualifier "28 d slope"; one muted footer "{slope_7d} kg/wk over 7 d"; no 30 d slope, because it restated the 28 d hero over a near-identical span | The phase label is a position on a rate scale; show the position. Colour only when the rate leaves the band the goal prescribes | `metric-card-bar`, `status-pill` |
| Weight series          | `GET /weight-log/series` · `points[].{date,weightKg}` (the trailing 7 d mean line is computed client-side)                                                                                                                                                                                                                                                                                                                                                 | Single value with a trend (large) | Line + dots + dashed 7d avg, 420 px      | Keep as the page's one big chart: same line + dashed trailing 7 d mean; add a `refLine` at the goal weight with a short mono label "goal {goal_kg}"; add a "last entry {n} days ago" qualifier in the header; chart height 280 px                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Right shape; the missing parts are the target and freshness                                                                     | —                                |
| Skinfold current       | `GET /skinfold-log/summary` · `perSite[].current` per site (top-level `current` is the latest date-average across sites, not used for the per-site rows), `ma7`, `ma30`, `direction` (`reducing`, `increasing`, `stable`); sparklines from `GET /skinfold-log/series`·`points[].{date,average,readings}`·`points[].readings[].{site,valueMm}`                                                                                                              | Single value with a trend ×2      | Six "—" tiles + two chips                | Strip cell with two rows: "Abdominal {mm} mm", "Suprailiac {mm} mm", each with sparkline and delta since the previous session; direction word from `direction` ("Reducing" / "Stable" / "Increasing") as a text chip; empty state replaces the cell (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Two sites, two sparklines; the six-tile grid is a template, not a need                                                          | `stat-strip`                     |
| Skinfold series        | `GET /skinfold-log/series` · `points[].{date,average,readings}`                                                                                                                                                                                                                                                                                                                                                                                            | Single value with a trend         | Empty chart card 420 px                  | When there are ≥2 sessions: line chart (series `skinfoldAbdominal`, `skinfoldSuprailiac`) 220 px with the average as a neutral dashed line. When 0–1 sessions: no chart, one empty-state row "No caliper session logged — a first reading sets the baseline" with the Log action inline                                                                                                                                                                                                                                                                                                                                                                                                                                  | An empty chart is 420 px of nothing; the row costs 56 px                                                                        | `empty-state`                    |
| Skinfold history       | `GET /skinfold-log`                                                                                                                                                                                                                                                                                                                                                                                                                                        | Record facts in a table row       | Table (empty)                            | Keep `BasaltDataTable` only when rows exist, columns Date, Site, mm (mono, right-aligned, unit in header), with `rowActions` delete; hidden when empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Rows are facts; an empty table adds nothing                                                                                     | `table-row`                      |
| Log weight / skinfold  | `POST /weight-log`, `POST /skinfold-log`                                                                                                                                                                                                                                                                                                                                                                                                                   | Form                              | Two tall cards, each with 2–3 big inputs | One `PageBar` action "Log weight" and one "Log skinfold" opening a `defineOverlays` modal (`*-modal.tsx`); date defaults to today, weight input pre-filled with the last value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Entry is rare (daily/monthly), reading is the page's job; the form should not outrank the data                                  | `form-field`                     |

## Layout

**1440.**

1. Summary sentence: "{weight} kg, {rate} kg/wk — {distance} kg to the {goal_kg} kg goal; last weigh-in {n} days ago."
2. `StatGroup variant="strip"`, three cells in one surface: Weight vs goal (hero + meter) | Rate (band meter + phase pill) | Skinfold (two site rows with sparklines, or the inline empty state).
3. Weight chart card, 280 px, full width (entry age = today minus the last `points[].date` of `/weight-log/series`; header facts: "{weight} kg · {delta} kg vs 30 d · 7 d mean {avg_short}").
4. Skinfold chart card only when ≥2 sessions exist, else the empty-state row; history table only when it has rows.

**390.** Strip becomes three stacked cells; weight chart 220 px with the legend moved below; "Log" actions collapse into the `PageBar` overflow menu.

**Charts: stay** weight line + trailing 7 d mean. **Change** its height (420 → 280 px), add goal ref line and freshness qualifier. **Go** the six-tile KPI rows (both), the in-page entry cards, the empty skinfold chart and table.

## Copy

Braces mark placeholders for the format.

- Summary: "{weight} kg, {rate} kg/wk, {distance} kg to the {goal_kg} kg goal; last weigh-in {n} days ago."
- Cells: "WEIGHT · latest {date}", "RATE · 28 d slope", "SKINFOLD · latest session {date}"
- Weight footer: "7 d mean {avg_short} · 30 d mean {avg_long} kg"
- Rate footer: "{slope_7d} kg/wk over 7 d"
- Chart title: "Body weight, 90 days"; qualifier "{n} entries"; ref label "goal {goal_kg}"
- Skinfold empty row: "No caliper session in this window — log abdominal and suprailiac to start a baseline." (Both sites are named because the table only accepts those two.)
- Staleness: "Last weigh-in {n} days ago" in muted text below 14 days; at ≥ 14 days the qualifier turns to the warn status colour (one threshold: muted under 14 days, warn from 14 days).
- The two filler subtitles are deleted; the section headings are dropped, the cards title themselves.

## Upstream candidates

| Pattern                            | Props sketch                                                                   | Planned export?                                              |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Meter with start → goal span       | `Meter value start goal ticks captions`                                        | `Meter` (wave 34), the "target tick" case                    |
| Band meter, signed                 | `Meter min={-0.5} max={0.5} neutral={[-0.1,0.1]} marker`                       | extension of `Meter`; new `neutral` zone prop                |
| Strip cell with two sparkline rows | `StatGroup variant="strip"` cell `rows={[{label,value,unit,sparkline,delta}]}` | `StatGroup variant="strip"` (wave 35), multi-row cell is new |
| Inline empty state                 | `EmptyState compact action` (row instead of a card)                            | exists (`EmptyState`); a `compact` variant is new            |

## Pass criteria

1. The first screen shows a summary sentence with weight, rate, distance to goal and entry age.
2. With a goal set, the weight chart carries a goal reference line and the hero cell a meter with a goal tick; with no goal there is neither, and a "Set a goal" action is present. The chart header states a value, a unit and a comparison.
3. No row of six tiles; no tile shows "—" alone — an empty skinfold history renders one empty-state row, not a grid.
4. Rate is a position on a labelled scale with the phase pill, not a coloured bare number.
5. Weight and skinfold entry are modals; no form card sits above a chart.
6. A weigh-in older than 14 days is visibly stale in the header qualifier.
7. At 390 nothing truncates and the strip cells stack.

## Wave 21 rounds

Shots of the live page (GET-only production proxy) plus a local overlay that injects a goal and four caliper sessions, because production has neither (the goal meter, skinfold cell, skinfold chart and history table are otherwise unrendered). Dirs are gitignored: `.design-shots/w21-body-composition-r{N}` and `-r{N}-mock`. Every round scored by a fresh `basalt-design-reviewer`.

| Round | Change                                                                                                                                                                                                                                         | Reviewer verdict                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| r0    | Baseline, unchanged page                                                                                                                                                                                                                       | not scored (baseline above)                                                |
| r1    | Summary sentence, 3-cell strip (weight + meter, rate band meter, skinfold rows), 280 px chart with goal line, log forms moved to `PageBar` modals, empty row                                                                                   | page pass; strip-weight, strip-rate, empty-row, weight chart fail          |
| r2    | Entry-count stats replaced by day-based stats from one shared derivation; intensity pill neutral; mono → sans for footers/chart facts; x axis drawn to today when stale; empty row on the card surface; y unit; anchors for charts and history | page pass; strips and charts fail on basalt-side items and missing anchors |
| r3    | Goal meter ends at the goal tick; start caption names itself; deltas name the prior session date; goal line solid; rate qualifier states the last entry date; all components anchored                                                          | see the last verdict below                                                 |

Decisions that deviate from the concept:

- **Entries vs days.** The summary endpoint's `ma7`, `ma30`, `weeklyDelta`, `monthlyDelta` are over the last 7/30 entries, not days; with a sparse log they contradicted each other and the entry count. The page derives 7 d / 30 d means and least-squares slopes (kg/wk, the API's method, so the rate cell uses one method throughout) from `/weight-log/series` (`model.ts`: `meanOverDays`, `slopeOverDays`) and states a period only when the window covers it and the entries span at least 70 % of it (`—` otherwise). The meter's start caption names the window's first entry and its date. `current` and `kgPerWeek` still come from the summary.
- **Intensity pill is neutral gray**, not `weightPhaseColor`: with a goal set the gold "bulk" tone contradicted a red delta moving away from it. The tier's kg/wk range sits in the meter's end caption instead.
- **"Set a goal"** is a one-field popover (`goal-popover.tsx`) rather than a third overlay, because the owned `OVERLAYS` entries are the two log modals.
- **Skinfold chart** needs ≥2 sessions; with 0 or 1 a single empty row carries the Log action.

## Wave 21 friction

| Export       | Needed prop                                                                          | argo case                                                             | What argo does instead                                                               |
| ------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `StatGroup`  | `variant="strip"` with multi-row cells                                               | three joined cells, one with sparkline rows                           | local `body-strip.tsx` + CSS module                                                  |
| `Meter`      | `start`/`goal` span with the goal tick at the track end and a `neutral` zone caption | progress from the window's first weight to the goal; signed rate band | fill = kg moved, `max` = span, `target` = span; zone label carries the neutral width |
| `Meter`      | proportional-sans captions, marker on the radius scale                               | numbers in captions render mono; marker radius is off-scale           | none (basalt-side)                                                                   |
| `Sparkline`  | `refLines` / mean tick                                                               | per-site sparkline should encode a target or mean                     | plain sparkline with an end dot                                                      |
| `DeltaBadge` | proportional-sans value                                                              | deltas read mono beside sans hero                                     | none (basalt-side)                                                                   |
| `EmptyState` | `compact` row variant with inline action                                             | skinfold empty state is one line plus a button                        | local `EmptyRow` inside a `Paper`                                                    |
| `RefLine`    | `label` rendered on the line                                                         | goal line wants an in-chart "goal {kg}" label                         | `legend.label` only                                                                  |
| `Lines`      | day-granular x tick format                                                           | x ticks show month names only on a 90 d window                        | default                                                                              |

Last verdict (r4, per component; production data / injected goal + sessions):

| Component        | Verdict     | Remaining fails                                                                                                                                                                 |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| page             | pass / pass | —                                                                                                                                                                               |
| strip-weight     | pass / fail | meter baseline (window start) vs the 30 d mean delta read as contradicting; both are labelled                                                                                   |
| strip-rate       | fail / fail | font-size count (10/11/13/22: basalt `Meter` caption sizes); the 28 d hero and the 7 d footer slope are one method over different spans of a noisy log                          |
| strip-skinfold   | — / pass    | —                                                                                                                                                                               |
| weight-chart     | fail / fail | font-size count on mobile (basalt axis), goal-line stroke vs the weight line (basalt `RefLine` has no distinct stroke), tooltip text when no goal (fixed after r4, not re-shot) |
| skinfold-chart   | — / fail    | mobile x ticks (basalt), duplicated line-end and legend labels (basalt)                                                                                                         |
| skinfold-history | — / fail    | mono numerals (table cell font), ISO dates (fixed after r4, not re-shot)                                                                                                        |
| empty-row        | pass / —    | —                                                                                                                                                                               |

r5 (after review round 1: one slope method in the rate cell, 70 % coverage guard, dated meter start, synthetic fixtures): rate and change signs agree everywhere, skinfold arithmetic and the goal distance match their cells. Remaining reviewer fails: font-size counts and mono captions (basalt `Meter`/axis), goal swatch identical to the weight swatch (basalt `RefLine`), mono thickness column in the history table (basalt table cell). Two argo items fixed after the r5 shot, not re-shot: the summary sentence now names the rate window ("over 28 d") and the rate meter drops the caption that restated the pill.

Remaining fails are basalt-side (see friction) or fixed after the last shot.

## Wave 21 live fixes

After the live review: the rate cell drops the 30 d footer slope; the header's, the cell's and the chart line's 7 d mean are one helper (`coveredWindow` / `trailingMean` in `charts/series-data.ts`, one `MEAN_DAYS`), and the line has a gap wherever the header would say `—`.

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. the weight cell's `30 d mean` broke at 390 and the `Set a goal` focus ring overlapped the unit.
- **Fixed between rounds (#87):** the goal action moved off the facts line; `{x} kg` joins are unbreakable (delta badge and meter captions included).
- **r2:** **pass** — every component and the page.
- **Against Keel:** close; the chart header repeats the strip's numbers and its end labels repeat the legend.
- **Open for Wave 24:** drop one of each repeated figure.

### Wave 24 fixes

- The page opens with `PageSummary` (replacing the bespoke `.summary` paragraph and its CSS): sentence `{weight} kg, {n} kg to the {goal} kg goal` (no goal: weight only), facts `{±r} kg/wk over {n} d` · `last weigh-in {age}`. `summaryParts` (pure, unit-tested) replaces `summarySentence`.
- Chart info tooltips lose all encoding prose (including the dashed-line notes) and state unit and meaning only.
- Basalt rows: none.

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the headline is a bare `{value} kg`, not a sentence; the 28 d rate sits beside a last weigh-in older than its window with no anchor; the rate cell's 7 d verdict disagrees with the 28 d meter it sits under; the weight chart header repeats the strip's figures.
- **Against Keel:** holds up.

### Wave 25 fixes

- Headline is a sentence: `Weight {falling|rising} {r} kg/wk over {n} d, {x} kg from the {goal} kg goal` (`holding steady` inside the maintenance band); the current weight moved to the facts line. When the last weigh-in is more than a day old the rate window is dated (`over the {n} d to {d MMM}`), and a weigh-in 14 d or older reads `· stale`.
- Rate cell carries one window: the 28 d (or shorter) slope. The 7 d slope is gone from the footer; the footer is the intensity tier, or why there is no rate ("a rate needs two weigh-ins at least 3 d apart").
- The unused 7 d slope (`slope7`, `slopeOverDays`) is removed; "at the goal" uses the module's 0.05 kg tolerance.
- Weight chart header states the net change across the window's entries and its start date (`windowChange`, unit-tested) instead of repeating the current weight, 7 d mean, 30 d delta and last-entry age that the strip and headline already show.
- Basalt rows: none.
- Round 2: the rate footer distinguishes loading, failure, zero weigh-ins and too-close weigh-ins. Weight appears once in the headline block; `shortDay` appends the year when it is not the current one; a one-entry window header shows that weight and its day. Unused `SummaryParams` removed.

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail. Fixed: the windows are anchored. Open: the headline restates the rate cell and the facts line the weight cell; `tier {range} kg/wk` undefined and `Lean bulk` repeats the zone label; the chart's net change since `{date}` reads against a headline in the other direction with no window note; the x-axis runs ~40 % past the last weigh-in; direct labels and legend name the same two series.
- **Against Keel:** close (was holds up under the softer bar).

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: no restated rate or weight in the headline; one plain pace footer; the chart's net change carries its dates; the x-axis ends at the last weigh-in. Carried: end labels and the legend name the same two series on wide (basalt `Lines` has no naming switch — UPSTREAM). **New:** `{n} weigh-ins in {d} d` names a span matching neither the window nor the rate; the weight line runs through the `7 d mean` end label now that the plot ends at the last point; the rate footer splits its unit at 390. Unscored: `30 d mean` breaks at 390; `Maintenance ±0.1` without a unit; the weight cell prints the 30 d mean twice.
- **Against Keel:** close — the chart header and strip still overlap.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail. Fixed: no `{n} weigh-ins in {d} d` span; the 30 d mean printed once; the maintenance band carries its unit. Carried: the weight line through the `7 d mean` end label; end labels and legend name the same series (basalt `Lines`); the rate footer range splits `{a}–` / `{b} kg/wk` at 390. **New:** the rate meter's zone captions bunch left instead of under their zones (the longer `Maintenance ±{x} kg/wk` label); `Bulk` wraps alone at 390; lost fact — `{n} weigh-ins` names no window. Unscored: the tooltip weight at two decimals vs one elsewhere; x-axis ticks `dd.mm` vs `{d} {Mon}`; the `·`-led wrap (basalt).
- **Against Keel:** close — the rate meter's labels no longer caption their segments.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: zone names centred under their zones (2.21.0); `Bulk` whole at 390; `{n} weigh-ins in {d} d` names its window; the rate range whole at 390; tooltip precision and `d MMM` ticks consistent. Carried: the weight line through the `7 d mean` end label; end labels and legend name the same series (basalt `Lines`). **New:** lost fact — the maintenance band's width (`±{x} kg/wk`) is stated nowhere on the surface now (it moved off the zone label and the start caption was dropped); the maintain zone has no name at 390 even with `short` set (basalt row). Unscored: `{n} days ago` and the `{n} days` chart title beside `{n} d`; the `·`-led wrap (basalt).
- **Against Keel:** close — the meter names its zones again, but its boundaries went with them.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail (argo items clean). Fixed: the maintenance band's width back once (`maintain ±{x} kg/wk` in the rate qualifier, zone `Maintenance`); one `{n} d` day spelling across headline, facts and chart titles. Carried (all basalt): the maintain zone unnamed at 390 even with `short`; the weight line through the `7 d mean` end label; end labels and legend name the same series; the `·`-led wrap at 390. **New:** none. Unscored: the chart info tooltip covers the net-change figure on focus (basalt).
- **Against Keel:** close — the meter has its names and its band width again; only shared-component overlaps remain.

### Wave 30 round (`w30-r1`, live after #122–#125 on basalt-ui 2.21.0)

- **Reviewer:** fail (no argo change, argo items clean). Carried (all basalt): the maintain zone unnamed at 390; the weight line through the `7 d mean` end label; end labels and legend name the same series; the `·`-led wrap at 390; the info tooltip over the net-change figure. **New:** none.
- **Against Keel:** close — only shared-component overlaps remain.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer (r1):** fail. Fixed: end labels and legend no longer both name a series (2.22 `Lines` naming: end labels at 1440, legend at 390); the facts line is sans; the `·`-led wrap at 390 is gone; linear lines. **Regression (r1), fixed and verified in r2:** dropping the local tooltip formatter for 2.22's default lost the weekday and year (the default prints `{d} {Mon}` here); the formatter is restored. **New (basalt):** the rate meter floats ~70 px below its hero in the taller strip row (`emptyRatio` 0.36). Carried (basalt): the maintain zone unnamed at 390; the weight line through the `7 d mean` end label; the info tooltip over the net change; the slashed zero in titles (2.22's reset did not reach them).
- **Against Keel:** close — shared-component overlaps remain.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail. Fixed: `craft-7/no-declared-states` (`empty` declared on `weight-chart`; the weight and skinfold series empty to their own branches). **New (argo, empty state):** the weight and rate strip cells keep their latest value, 7 d mean, 30 d delta and 28 d slope while the chart below says the window has no entries — the strip must empty with the series. Carried (basalt): the maintain zone unnamed at 390; the rate meter floating under its hero; the weight line through the `7 d mean` end label; the info tooltip over the net change; the slashed zero in titles. The w31 r2 tooltip date (`EEE d MMM yyyy`) holds. No lost fact.
- **Against Keel:** close — shared-component overlaps remain.

### Wave 33 fixes

- **Empty state:** the page substitutes the empty weight summary and series at the read under `?shot-state=empty`, so the strip (latest value, `7 d mean`, 30 d delta, 28 d slope, rate) empties with the chart — production with no entries renders the same. The headline carries the full sentence (`NO_WEIGHT_ENTRIES`: cause + next step); the chart empty and the weight and rate cell footers say the cause only (`NO_WEIGHT_ENTRIES_SHORT`: `No entries in this window`).

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail. Fixed: the strip empties with the series (`—` + `No entries in this window`, no 7 d mean, delta or slope left behind); the rate qualifier makes no slope claim without entries. **New (argo):** the rate cell words one gap twice under `empty` (the meter's `No rate yet` above the footer's `No entries in this window`); the chart and weight cell carry the cause only, and the headline that holds the next step has no empty shot of its own (unverifiable). Carried (basalt): the maintain zone unnamed at 390, the weight line through its `7 d mean` end label, the info tooltip over the net change, the slashed zero. No lost fact.
- **Against Keel:** close — the remaining overlaps are shared basalt components.

### Wave 34 round (`w34-r1`, live after #144–#147 on basalt-ui 2.22.0; `w34-r2` after #148)

- **Reviewer:** fail (basalt only). Fixed: the rate cell under `empty` says its gap once (the meter's `No rate yet` is gone; the footer reads `No entries in this window`); the qualifier makes no slope claim. Carried (argo): the empty headline that holds the next step has no shot of its own (unverifiable). Carried (basalt): the maintain zone unnamed at 390, the weight line through its `7 d mean` end label, the info tooltip over the net change, the slashed zero. Unscored: the cause clause `No entries in this window` appears in three places on the empty screen (weight cell, rate cell, chart) — the W33 design. No lost fact.
- **Against Keel:** close — the remaining overlaps are shared basalt components.

### Wave 35 round (`w35-r1`, live after #149–#151 on basalt-ui 2.22.0)

- **Reviewer:** fail (basalt only). Untouched this wave; pixel-identical to w34. Carried (basalt): the rate meter's unnamed middle zone at 390; the weight line through its own end labels; the info tooltip over the net change; the floating meter in a tall cell; the slashed zero. Unscored (argo): under `empty` the weight cell, the rate cell and the chart all read `No entries in this window` — the short form is right only if the headline carries the full sentence, and there is still no page-level empty shot to check it. No lost fact.
- **Against Keel:** close — what remains is basalt's.
- **Re-score `w35-r2` (after basalt-ui 2.23.0, #152):** fail. Verified: the weight tooltip header now prints `{Dow}, {d} {Mon} {yyyy}` from basalt's default, so the local `formatHeader` is gone (the skinfold chart has no session to render and is unverified); the rate meter no longer floats under its value. Not closed (basalt): the rate meter's unnamed middle zone at 390; the weight line through its `7 d mean` end label. **New (basalt, P1 — a lost fact):** at 390 the rate cell's qualifier now takes its own line and truncates to `{n} d slope to {date}, maintain ±…`, so the maintain band appears nowhere on that surface (2.23's qualifier-under-240-px default; no local workaround — UPSTREAM row).

### Wave 36 round (`w36-r1`, live after #153–#155 on basalt-ui 2.23.0; `w36-r2` after #156–#158)

- **Reviewer (`w36-r1`):** fail on the carried basalt P1 only (untouched by argo): at 390 the rate cell's qualifier truncates to `… maintain ±…`, so the band appears nowhere on the cell (basalt Wave 38). Carried (basalt): the meter's unnamed middle zone, the weight line through its end labels, `Set a goal` hover identical to rest. Unscored before (basalt, P3): `—` above `No entries in this window` in the empty strip cells (the `StatStrip` empty-state row). No new lost fact.
- **Against Keel:** close — what remains is basalt's.

### Wave 37 round (`w37-r1`, live after #160–#162 on basalt-ui 2.23.0; untouched)

- **Reviewer (`w37-r1`):** fail on basalt only — the 390 rate qualifier truncates before the maintain band (basalt Wave 38). Carried (basalt): the strip `—` above `No entries in this window`, the unnamed middle meter zone at 390, the weight line through its end labels, the `Set a goal` hover identical to rest. No regression, no lost fact.
- **Against Keel:** close — what remains is basalt's.
