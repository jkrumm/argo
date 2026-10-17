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

| Dataset | Source | Shape (SPEC §3) | Today | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Current weight vs goal | `GET /weight-log/summary` · `current`; goal from `GET /user-profile` · `goal_weight_kg` (snake_case on the wire; nullable). **No-goal state:** with `goal_weight_kg` = null the hero cell shows value, delta and 7 d / 30 d means only, with no meter, no goal tick and no chart refLine; the footer carries one action "Set a goal" that opens the profile weight field (`PUT /user-profile`), and the summary sentence drops the distance-to-goal clause | Progress to a target | Tile "{weight} kg" + badge | Hero cell: "{weight}" + muted "kg", delta text "{delta} kg vs 30 d", `Meter` bar from start-of-window weight to goal weight with a tick at the goal and end captions "{start_weight} kg" "{goal_kg} kg goal"; caption "WEIGHT · latest {date}"; qualifier "goal {goal_kg}" | The goal exists in the profile but is never shown; progress to a target is a meter with the target tick | `metric-card-bar` |
| Rolling averages | `/weight-log/summary` · `ma7`, `ma30`, `trend` | Single value with a trend | Two bare tiles | Merged into the weight chart's legend and the hero cell's footer: "7 d mean {avg_short} · 30 d mean {avg_long} kg"; the dashed 7-day average line on the chart stays | An average is a line on the chart, not a tile | `stat-cell` |
| Rate of change | `/weight-log/summary` · `weeklyDelta`, `monthlyDelta`, `kgPerWeek`, `phase` (`losing`, `gaining`, `maintaining`), `intensity` | Single value with a trend | Three tiles, coloured by sign | One strip cell "RATE": "{rate} kg/wk" with `DeltaBadge`-style text delta, a pill with the API's `intensity` string ("{intensity}"), which the page shows verbatim: `phase` only picks the pill tone via the existing `weightPhaseColor` (`losing` blue, `gaining` yellow, `maintaining` gray); the tiers behind `intensity` are Maintenance (abs rate < 0.1 kg/wk), Lean/Standard/Aggressive cut (< 0.4, < 0.8, ≥ 0.8) and Lean/Standard/Aggressive bulk (< 0.3, < 0.6, ≥ 0.6), and a `Meter` band −0.5…+0.5 kg/wk with neutral zone ±0.1, marker at the current rate; qualifier "28 d slope"; weekly Δ and monthly Δ as muted footer "{weekly_delta} kg 7 d · {monthly_delta} kg 30 d" | The phase label is a position on a rate scale; show the position. Colour only when the rate leaves the band the goal prescribes | `metric-card-bar`, `status-pill` |
| Weight series | `GET /weight-log/series` · `points[].{date,weightKg}` (the 7-day average line is computed client-side) | Single value with a trend (large) | Line + dots + dashed 7d avg, 420 px | Keep as the page's one big chart: same line + dashed 7 d average; add a `refLine` at the goal weight with a short mono label "goal {goal_kg}"; add a "last entry {n} days ago" qualifier in the header; chart height 280 px | Right shape; the missing parts are the target and freshness | — |
| Skinfold current | `GET /skinfold-log/summary` · `perSite[].current` per site (top-level `current` is the latest date-average across sites, not used for the per-site rows), `ma7`, `ma30`, `direction` (`reducing`, `increasing`, `stable`); sparklines from `GET /skinfold-log/series`·`points[].{date,average,readings}`·`points[].readings[].{site,valueMm}` | Single value with a trend ×2 | Six "—" tiles + two chips | Strip cell with two rows: "Abdominal {mm} mm", "Suprailiac {mm} mm", each with sparkline and delta since the previous session; direction word from `direction` ("Reducing" / "Stable" / "Increasing") as a text chip; empty state replaces the cell (below) | Two sites, two sparklines; the six-tile grid is a template, not a need | `stat-strip` |
| Skinfold series | `GET /skinfold-log/series` · `points[].{date,average,readings}` | Single value with a trend | Empty chart card 420 px | When there are ≥2 sessions: line chart (series `skinfoldAbdominal`, `skinfoldSuprailiac`) 220 px with the average as a neutral dashed line. When 0–1 sessions: no chart, one empty-state row "No caliper session logged — a first reading sets the baseline" with the Log action inline | An empty chart is 420 px of nothing; the row costs 56 px | `empty-state` |
| Skinfold history | `GET /skinfold-log` | Record facts in a table row | Table (empty) | Keep `BasaltDataTable` only when rows exist, columns Date, Site, mm (mono, right-aligned, unit in header), with `rowActions` delete; hidden when empty | Rows are facts; an empty table adds nothing | `table-row` |
| Log weight / skinfold | `POST /weight-log`, `POST /skinfold-log` | Form | Two tall cards, each with 2–3 big inputs | One `PageBar` action "Log weight" and one "Log skinfold" opening a `defineOverlays` modal (`*-modal.tsx`); date defaults to today, weight input pre-filled with the last value | Entry is rare (daily/monthly), reading is the page's job; the form should not outrank the data | `form-field` |

## Layout

**1440.**

1. Summary sentence: "{weight} kg, {rate} kg/wk — {distance} kg to the {goal_kg} kg goal; last weigh-in {n} days ago."
2. `StatGroup variant="strip"`, three cells in one surface: Weight vs goal (hero + meter) | Rate (band meter + phase pill) | Skinfold (two site rows with sparklines, or the inline empty state).
3. Weight chart card, 280 px, full width (entry age = today minus the last `points[].date` of `/weight-log/series`; header facts: "{weight} kg · {delta} kg vs 30 d · 7 d mean {avg_short}").
4. Skinfold chart card only when ≥2 sessions exist, else the empty-state row; history table only when it has rows.

**390.** Strip becomes three stacked cells; weight chart 220 px with the legend moved below; "Log" actions collapse into the `PageBar` overflow menu.

**Charts: stay** weight line + 7-day average. **Change** its height (420 → 280 px), add goal ref line and freshness qualifier. **Go** the six-tile KPI rows (both), the in-page entry cards, the empty skinfold chart and table.

## Copy

Braces mark placeholders for the format.

- Summary: "{weight} kg, {rate} kg/wk, {distance} kg to the {goal_kg} kg goal; last weigh-in {n} days ago."
- Cells: "WEIGHT · latest {date}", "RATE · 28 d slope", "SKINFOLD · latest session {date}"
- Weight footer: "7 d mean {avg_short} · 30 d mean {avg_long} kg"
- Rate footer: "{weekly_delta} kg 7 d · {monthly_delta} kg 30 d"
- Chart title: "Body weight, 90 days"; qualifier "{n} entries"; ref label "goal {goal_kg}"
- Skinfold empty row: "No caliper session in this window — log abdominal and suprailiac to start a baseline." (Both sites are named because the table only accepts those two.)
- Staleness: "Last weigh-in {n} days ago" in muted text below 14 days; at ≥ 14 days the qualifier turns to the warn status colour (one threshold: muted under 14 days, warn from 14 days).
- The two filler subtitles are deleted; the section headings are dropped, the cards title themselves.

## Upstream candidates

| Pattern | Props sketch | Planned export? |
|-|-|-|
| Meter with start → goal span | `Meter value start goal ticks captions` | `Meter` (wave 34), the "target tick" case |
| Band meter, signed | `Meter min={-0.5} max={0.5} neutral={[-0.1,0.1]} marker` | extension of `Meter`; new `neutral` zone prop |
| Strip cell with two sparkline rows | `StatGroup variant="strip"` cell `rows={[{label,value,unit,sparkline,delta}]}` | `StatGroup variant="strip"` (wave 35), multi-row cell is new |
| Inline empty state | `EmptyState compact action` (row instead of a card) | exists (`EmptyState`); a `compact` variant is new |

## Pass criteria

1. The first screen shows a summary sentence with weight, rate, distance to goal and entry age.
2. With a goal set, the weight chart carries a goal reference line and the hero cell a meter with a goal tick; with no goal there is neither, and a "Set a goal" action is present. The chart header states a value, a unit and a comparison.
3. No row of six tiles; no tile shows "—" alone — an empty skinfold history renders one empty-state row, not a grid.
4. Rate is a position on a labelled scale with the phase pill, not a coloured bare number.
5. Weight and skinfold entry are modals; no form card sits above a chart.
6. A weigh-in older than 14 days is visibly stale in the header qualifier.
7. At 390 nothing truncates and the strip cells stack.
