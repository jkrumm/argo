# Body Composition — concept

Route `/body-composition` · `apps/dashboard/src/routes/body-composition.tsx`, `apps/dashboard/src/features/body-composition/` (`components/weight-panel.tsx`, `skinfold-panel.tsx`, `charts/`, `formulas.ts`).

## Baseline verdict

Baseline: `.design-shots/baseline/body-composition--dark--desktop.png`, crops `body-composition--dark--01-card.png` (weight KPI row), `02-body-weight.png`, `03-card.png` (skinfold KPI row), `04-skinfold-belly-fat.png`, `05-card.png` (skinfold table). Production data, 2026-10-17, 90d window.

- **Slop.** Two rows of six same-size tiles (`01-card`, `03-card`): "Current 73 kg", "7d avg 72.1", "30d avg 72.5", "Weekly Δ +0.9", "Monthly Δ −0.4", "kg / week +0.16". Five of them are bare numbers with no scale and no history; "Weekly Δ" and "Monthly Δ" carry a green or amber colour whose direction is not explained (a gain is amber, a loss green, regardless of the goal). The "LEAN BULK" badge is the only interpretation on the page and it sits in a tile corner.
- **Skinfold half is dead space.** `03-card` is six "—" tiles, `04-skinfold-belly-fat` is a 420 px empty chart saying "No readings yet — log your first caliper session", `05-card` an empty table. Roughly 45 % of the page height shows nothing.
- **Forms are as tall as the data.** "Log Weight" and "Log Skinfold" are full-width cards with two oversized date/number inputs and a Save button, one above each chart.
- **Filler subtitles:** "Am I trending toward my goal?" (shown twice, once on the section and once in the chart card) and "Am I trending leaner?" (twice).
- **Chart data stops early.** The weight line in `02` ends in late August in a 90-day window ending Oct 17; the page never says the last entry is old.
- **Distance from bar: 4/5.** One real chart (weight line + 7d average is the right shape), everything around it is a row of tiles, forms and empty states.

## The question and the decision

- **Question on opening:** where is my weight going against the goal, how fast, and is my waist getting leaner?
- **Decision:** eat more or less this week (adjust the surplus/deficit), and whether to take a caliper session now.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Current weight vs goal | `GET /weight-log/summary` `.current`; `user_profile.goal_weight_kg` (`GET /user-profile`) | Progress to a target | Tile "73 kg" + badge | Hero cell: "72.8" + muted "kg", delta text "+0.7 kg vs 30 d", `Meter` bar from start-of-window weight to goal weight with a tick at the goal and end captions "72.1 kg" "75.0 kg goal"; caption "WEIGHT · latest {Oct 17}"; qualifier "goal 75.0" | The goal exists in the profile but is never shown; progress to a target is a meter with the target tick | `metric-card-bar` |
| Rolling averages | `/weight-log/summary` `.ma7 .ma30 .trend` | Single value with a trend | Two bare tiles | Merged into the weight chart's legend and the hero cell's footer: "7 d mean 72.1 · 30 d mean 72.5 kg"; the dashed 7-day average line on the chart stays | An average is a line on the chart, not a tile | `stat-cell` |
| Rate of change | `/weight-log/summary` `.weeklyDelta .monthlyDelta .kgPerWeek .phase .intensity` | Single value with a trend | Three tiles, coloured by sign | One strip cell "RATE": "+0.16 kg/wk" with `DeltaBadge`-style text delta, a pill "Lean bulk" (the existing `phase`), and a `Meter` band −0.5…+0.5 kg/wk with neutral zone ±0.1, marker at +0.16; qualifier "28 d slope"; weekly Δ and monthly Δ as muted footer "+0.9 kg 7 d · −0.4 kg 30 d" | The phase label is a position on a rate scale; show the position. Colour only when the rate leaves the band the goal prescribes | `metric-card-bar`, `status-pill` |
| Weight series | `GET /weight-log/series` | Single value with a trend (large) | Line + dots + dashed 7d avg, 420 px | Keep as the page's one big chart: same line + dashed 7 d average; add a `refLine` at the goal weight with a short mono label "goal 75.0"; add a "last entry {n} days ago" qualifier in the header; chart height 280 px | Right shape; the missing parts are the target and freshness | — |
| Skinfold current | `GET /skinfold-log/summary` `.current` per site, `.ma7 .ma30 .direction` | Single value with a trend ×2 | Six "—" tiles + two chips | Strip cell with two rows: "Abdominal 14.2 mm", "Suprailiac 11.8 mm", each with sparkline and delta since the previous session; direction word "Reducing" as a text chip; empty state replaces the cell (below) | Two sites, two sparklines; the six-tile grid is a template, not a need | `stat-strip` |
| Skinfold series | `GET /skinfold-log/series` | Single value with a trend | Empty chart card 420 px | When there are ≥2 sessions: line chart (series `skinfoldAbdominal`, `skinfoldSuprailiac`) 220 px with the average as a neutral dashed line. When 0–1 sessions: no chart, one empty-state row "No caliper session logged — a first reading sets the baseline" with the Log action inline | An empty chart is 420 px of nothing; the row costs 56 px | `empty-state` |
| Skinfold history | `GET /skinfold-log` | Record facts in a table row | Table (empty) | Keep `BasaltDataTable` only when rows exist, columns Date, Site, mm (mono, right-aligned, unit in header), with `rowActions` delete; hidden when empty | Rows are facts; an empty table adds nothing | `table-row` |
| Log weight / skinfold | `POST /weight-log`, `POST /skinfold-log` | Form | Two tall cards, each with 2–3 big inputs | One `PageBar` action "Log weight" and one "Log skinfold" opening a `defineOverlays` modal (`*-modal.tsx`); date defaults to today, weight input pre-filled with the last value | Entry is rare (daily/monthly), reading is the page's job; the form should not outrank the data | `form-field` |

## Layout

**1440.**

1. Summary sentence: "72.8 kg, +0.16 kg/wk — 2.2 kg to the 75.0 kg goal; last weigh-in {n} days ago."
2. `StatGroup variant="strip"`, three cells in one surface: Weight vs goal (hero + meter) | Rate (band meter + phase pill) | Skinfold (two site rows with sparklines, or the inline empty state).
3. Weight chart card, 280 px, full width (header facts: "72.8 kg · +0.7 kg vs 30 d · 7 d mean 72.1").
4. Skinfold chart card only when ≥2 sessions exist, else the empty-state row; history table only when it has rows.

**390.** Strip becomes three stacked cells; weight chart 220 px with the legend moved below; "Log" actions collapse into the `PageBar` overflow menu.

**Charts: stay** weight line + 7-day average. **Change** its height (420 → 280 px), add goal ref line and freshness qualifier. **Go** the six-tile KPI rows (both), the in-page entry cards, the empty skinfold chart and table.

## Copy

Numbers in braces are illustrative placeholders for the format.

- Summary: "{72.8} kg, {+0.16} kg/wk, {2.2} kg to the {75.0} kg goal; last weigh-in {1} day ago."
- Cells: "WEIGHT · latest {Oct 17}", "RATE · 28 d slope", "SKINFOLD · latest session {date}"
- Weight footer: "7 d mean {72.1} · 30 d mean {72.5} kg"
- Rate footer: "{+0.9} kg 7 d · {−0.4} kg 30 d"
- Chart title: "Body weight, 90 days"; qualifier "{33} entries"; ref label "goal {75.0}"
- Skinfold empty row: "No caliper session in this window — log abdominal and suprailiac to start a baseline." (Both sites are named because the table only accepts those two.)
- Staleness: "Last weigh-in {n} days ago" in muted text when > 7 days; at ≥ 14 days the qualifier turns to the warn status colour.
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
2. The weight chart carries a goal reference line and its header states a value, a unit and a comparison.
3. No row of six tiles; no tile shows "—" alone — an empty skinfold history renders one empty-state row, not a grid.
4. Rate is a position on a labelled scale with the phase pill, not a coloured bare number.
5. Weight and skinfold entry are modals; no form card sits above a chart.
6. A weigh-in older than 14 days is visibly stale in the header qualifier.
7. At 390 nothing truncates and the strip cells stack.
