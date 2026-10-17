# WalkingPad — concept

Route `/walking-pad` · `apps/dashboard/src/routes/walking-pad.tsx`, `apps/dashboard/src/features/walking-pad/` (`record-header.tsx`, `strip-cells.tsx`, `week-chart.tsx`, `distance-chart.tsx`, `hour-grid.tsx`, `history-table.tsx`, `achievements-list.tsx`, `model.ts`).

## Baseline verdict

Baseline: `.design-shots/baseline/walking-pad--dark--desktop.png`, crops `walking-pad--dark--01-volume.png` … `09-energy.png` (hero tiles), `10-card.png` (live/last-walk card), `11-daily-activity.png` … `15-time-of-day.png` (charts), `16-card.png` (session table). Production data, 2026-10-17, "Last 30 days" window; the last walk was {age} days ago, so the window holds zero sessions.

- **The default view is empty.** Nine tiles (`01`–`09`) show "0.00 km", "—", "0 days", "avg 0 m · best 0 m", "avg 0.00 km/h · best 0.00 km/h": zero-valued numbers and dashes, with the window's emptiness never named in one place. Five chart cards (`11`, `12`, `13`, `14`, `15`) are 300 px of centred "No walks in this window" text. About 60 % of the page height is empty regions.
- **Slop.** Tile subtitles that truncate mid-sentence ("Not enough prior data to compare …", "No walks in this window — last w…"); the "Streak" tile pairs "Best {n}d" with "Momentum Steady" as two bare rows; a "1 metrics" filter chip; six filler-question subtitles ("How is each day adding up?", "How much did I walk each day?", "Am I walking faster over time?", "Am I keeping the habit alive week to week?", "Is the habit holding week to week?", "How far are my walks?", "When do I tend to walk?"). The section subtitle and the chart subtitle ask the same question twice.
- **The one rich surface is hidden.** `10-card` (idle card: "Last walk {age} d ago · {km} km in {duration} · avg {pace} km/h", {km} km / {steps} steps / {kcal} kcal) is the only block that answers anything, and the {n}-row achievements list (`walking-pad--dark--desktop.png`, right column) is a scrolling stack of near-identical rows ("{streak_title}" repeated {n} times).
- **History table** (`16-card`) is the right shape for session rows and is correct in structure (mono figures, units in cells) but repeats the unit "km/h", "kcal" in every cell.
- **Distance from bar: 5/5.** Highest of the three: the default state shows no data at all, and the encodings (nine tiles) assume a populated window.

## The question and the decision

- **Question on opening:** am I keeping the walking habit — how many days this week, how far, how fast — and what was the last session?
- **Decision:** walk today (and for how long/fast) to hold the week's target and the streak.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Window default | `GET /walking-pad/sessions/summary` · `sessions`; last walk from `GET /walking-pad/sessions?limit=1` · `data[0].ended_at` | State | 30-day window (`walkingStore` fallback `30d`) that is empty | Keep the `30d` fallback; when the window has `sessions` = 0, one empty-state row names it: "No walks in the last 30 days — last walk {date}, {age} days ago" with an action "Show 90 days" (the next preset in `WALKING_WINDOW_VALUES`: `7d 30d 90d 6m 1y all`; there is no 12-week preset) | The page's first impression is the data, not its absence | `empty-state` |
| Live / last session | `GET /walking-pad/live`; `GET /walking-pad/sessions?limit=1` · `data[0].{ended_at,distance_m,duration_s,avg_speed_kmh,steps,kcal}` | An entity with facts | Wide idle card with three stats | Record header: status dot + "Idle", facts line "last walk {age} d ago · {km} km · {duration} · {pace} km/h", stats right "{steps} steps · {kcal} kcal"; while live the same header shows a pulse and the current pace/distance in the figures | One row says what the pad is doing; keep the live branch | `record-header` |
| Weekly volume vs target | `/sessions/series?bucket=week` · `points[].distance_m` (Monday-keyed weeks): the last bucket is this week, the one before it is last week; the window-level `heroes` `volume` is not used here | Progress to a target + trend | Tile "0.00 km" + weekly bar chart (empty) | Strip cell "THIS WEEK": "{km}" + muted "km", delta text "{delta} km vs last week", `Meter` bar to a weekly target (the target is a new user setting, none exists today; placeholder 15 km) with a tick, end captions "0" "15 km"; qualifier "Mon–Sun" | A habit is a progress-to-target; prior-period comparison is the delta | `metric-card-bar` |
| Pace | `/sessions/heroes` · `pace.{currentAvgKmh,priorAvgKmh,deltaKmh}`; sparkline from `/sessions/series?bucket=week` · `points[].avg_speed_kmh` (null buckets break the line) | Single value with a trend | Tile "—" | Strip cell "PACE": "{pace}" + muted "km/h", delta "{delta} km/h vs the prior 30 d", sparkline of the weekly distance-weighted average pace (one point per week bucket, not per session) with end dot; delta text "vs prior window" with the window named in the qualifier | A pace is read against its own history | `stat-strip` |
| Streak | `/sessions/heroes` · `streak.{currentDays,bestDays,walkedToday,momentum,sessionsThisWeek}`; the seven ticks come from `/sessions/series?bucket=day` over `7d` · `points[].sessions` (> 0 = filled; Mon–Sun, UTC days) | Part of a whole (days in week) | Tile "0 days" + Best/Momentum rows | Strip cell "STREAK": "{streak}" + muted "days", seven-day ticks (Mon–Sun, filled = walked, today outlined) as a `BandStrip`, caption "best {n} d"; the momentum word is dropped (it is derived from the same days) | A streak is days in a row; the day strip shows which | `metric-card-bar` (segmented), `schedule-item` |
| Session totals | `/sessions/summary` · `sessions`, `duration_s`, `distance_m`, `steps`, `kcal`, `avg_session_min` | Single value with a trend ×5 | Six tiles "—" | One strip cell with three rows: "Sessions {n} · avg {km} km", "Time {duration} · avg {duration}", "Energy {kcal} kcal · {steps} steps in the window"; no sparklines (they repeat the weekly chart) | The five totals are one reading; the tiles are one per number | `stat-cell` |
| Daily activity | `/sessions/series?bucket=day` · `points[].distance_m` | Status over time | Bar chart (empty) | `BandStrip`/`Bars` with one bar per day over the window, y = km, refLine at the daily mean; height 180 px; hidden when the window has 0 sessions | A walking day is binary-plus-size; per-day bars show the rhythm | `timeline-event` |
| Pace trend | `/sessions/series?bucket=week` · `points[].avg_speed_kmh` | Single value with a trend | Line (empty) | Merged into the Pace cell's sparkline; chart only behind a "Pace" `ViewTabs` entry on the weekly chart | Duplicate encoding | — |
| Weekly volume | `/sessions/series?bucket=week` · `points[].distance_m` | Single value with a trend | Bars (empty) | Keep `Bars`, one bar per week bucket of the selected window, neutral, current week accent, target refLine; this is the page's main chart; the "walks this week" count is `streak.sessionsThisWeek` | Right shape; add target | — |
| Session distance distribution | `/sessions/length-histogram?metric=distance` · `buckets[].{bucketStart,bucketWidth,sessions}` | Distribution | Histogram (empty) | Keep `Bars` histogram, axis-less 120 px, in a half-width card beside time-of-day; header "median {median_km} km, longest {longest_km} km", both computed client-side from `GET /walking-pad/sessions` rows (`distance_m`), because the histogram returns only bucket counts | Skew is the reading | — |
| Time of day | `/sessions/hour-of-day` · `cells[].{dow,hour,sessions}` (the API buckets by UTC; the client shifts each cell to local time with the browser's zone offset before drawing, and says "local time" in the header), `totalSessions` | Distribution (hour × weekday) | Matrix (empty) | Keep the matrix as a 7×24 heat grid, 140 px; header "most walks {weekday} {hour} local time" | Right shape | — |
| Session history | `GET /walking-pad/sessions` (paginated) | Record facts in a table row | Table, unit in each cell | `BasaltDataTable` with units in the header ("Distance km", "Pace km/h", "Energy kcal"), mono right-aligned figures, `relative-time` in When with the date in a tooltip, pause count as an inline chip; keep pagination | Fewer repeated unit strings; rows scannable by shape | `table-row`, `table-header` |
| Achievements | `GET /walking-pad/achievements` · `title`, `description`, `unlocked_at`, `type` ({n} rows) | Event sequence | Scrolling card, {n_visible} visible, repeated rows | `EventList` day-grouped by month, collapsed repeats ("{streak_title} ×{n}, last {age} d ago"), count in the heading "{n} unlocked"; right column of the history row, max 6 visible plus "Show all" | Repeats are rhythm, not rows | `timeline-event` |

## Layout

**1440.**

1. Summary: "{km} km this week in {n} walks; streak {streak} d; pace {pace} km/h, {delta} vs the prior 30 days."
2. Record header (live / last walk).
3. `StatGroup variant="strip"` of 4 cells: This week (meter), Pace (sparkline), Streak (day strip), Totals (three rows).
4. Weekly volume `Bars` (full width, week buckets of the selected window, 240 px).
5. Two-column row: session-distance histogram | time-of-day grid.
6. Two-column row: history table (wide) | achievements `EventList` (narrow).
7. Daily rhythm chart goes into the weekly card behind a `ViewTabs` ("Weeks | Days"); the pace chart behind "Pace".

**390.** Strip cells stack in two columns of two (SPEC §6.5, never four squeezed); weekly chart 200 px; histogram and time-of-day stack; achievements collapse to 3 rows plus "Show all"; the history table folds to Date, Distance, Pace with a pinned first column.

**Charts: stay** weekly volume, histogram, time-of-day. **Change** daily activity (merged behind a tab), pace trend (into the strip), achievements (list → `EventList`). **Go** the nine KPI tiles, four of the five section subtitles, the standalone empty cards.

## Copy

Braces mark placeholders for the format.

- Summary: "{km} km this week in {n} walks; streak {streak} d; pace {pace} km/h, {delta} vs the prior 30 days."
- Cells: "THIS WEEK · Mon–Sun", "PACE · avg 30 d", "STREAK · best {best} d", "TOTALS · 30 d"
- Record header idle: "Idle · last walk {age} d ago · {km} km · {duration} · {pace} km/h"
- Chart titles: "Weekly distance, last 30 days" (qualifier "target {target} km"); "Session distance, last 30 days" (qualifier "median {median_km} km"); "Walks by hour, last 30 days" (qualifier "peak {weekday} {hour}")
- Empty: "No walks in the last 30 days — last walk {date}, {age} days ago." Action "Show 90 days".
- Achievements heading: "Achievements" + count chip "{n}"; row "{streak_title} ×{n} · last {age} d ago"
- Delete the six filler questions; the section headings go with them (cards self-title).

## Upstream candidates

| Pattern | Props sketch | Planned export? |
|-|-|-|
| Week strip (7 day ticks, today outlined) | `BandStrip` `cells={[{label,state}]}` with `today` marker | exists (`BandStrip`); today outline is new |
| Record header with live pulse | `RecordHeader {glyph,title,status,pulse,facts[],stats[],actions}` | planned recipe (SPEC §6.9 record page); `pulse` is new |
| `EventList` with collapsed repeats | `EventList groupBy="month" collapse={(a,b)=>boolean} count` | `EventList` (wave 37); `collapse` is new |
| Empty-with-action row | `EmptyState compact action` | new variant of `EmptyState` |

## Pass criteria

1. When the default 30-day window has sessions, the first screen has a summary sentence and no zero-valued tile. When it is empty (as in the baseline), the page shows the record header with the last-walk facts and exactly one empty-state row naming the window — no strip of zeros, no empty chart cards.
2. A window with no sessions renders exactly one empty-state row that names the window, the last-walk date and a widen action; no chart card is empty.
3. Weekly distance carries a target tick/refLine; streak shows the seven days, not "0 days".
4. Pace shows "km/h" inline, a delta with its comparison period and a sparkline with an end dot.
5. Achievements show a count in the heading and collapse repeats; no row repeats the same title more than once.
6. The history table has units in headers only, relative time with a date tooltip.
7. No filler-question subtitle remains; no tile subtitle truncates at 1440 or 390.

## Wave 21 rounds

Shots: `apps/dashboard/.design-shots/w21-walking-pad-r{0,1,3,4}` (empty default window) and `…-r{1,3,4}-all` (`?window=all`, the populated state), gitignored. Production's default 30-day window holds no walks, so the populated state is shot with the all-time window.

- **r0** baseline, the old page (nine zero tiles, five empty chart cards).
- **r1** (reviewer: record header and empty default pass; summary, strip cells, achievements, page fail). Failed: the summary's pace had no period or comparison; the week delta had no direction glyph; the pace sparkline encoded no limit; streak ticks were near-invisible; Totals broke mid-unit at 390 and never named its period; achievements had no heading inside the card and no count; chart x ticks read `dd.mm`; the hour grid labelled three of seven weekdays; the histogram was accent-filled for a single metric; the weekly target read as a fact. The four charts, the table and the empty row had no anchors, so they went unscored.
- **r2** (own read). Changed: charts, table, empty row and achievements got `data-shot` anchors; weekly x ticks use the app locale; the two lower charts are 180 px so every weekday labels.
- **r3** (reviewer: summary, record header, strip week/pace/streak, weekly chart, empty row pass; Totals, distance, hours, history, achievements fail). Failed: `ChartCard` folds a long `subtitle` into an info icon at half width, so the median, longest and peak facts were hover-only; the hour grid was accent-filled for a single metric and its tooltip said `Value`; the history "When" cell wrapped to five lines at 390; the achievements heading sat outside the card and `{n}` against "Show all {m}" read as a contradiction; Totals wrapped inside a figure; the Pace cell ({p} km/h) and the Totals cell ({km} over {duration}) disagree because pace is a distance-weighted mean of walk speeds.
- **r4** changed: facts headers moved into the card body (`facts.tsx`); the hour grid is neutral with `Walks` and `Distance` tooltip rows and names its first visible hour; histogram ticks are bucket starts with the range in the tooltip; history columns carry fold priorities and a pinned first column, so 390 shows When, Distance and Pace with the rest behind a row disclosure; achievements draw their heading inside the card and read `{n}` with "Show all {m} titles"; Totals stacks figure over context; the Pace footer names the weighted mean; default target is labelled `default`.

Against Keel (`root--dark--desktop`, the strip and record-header patterns): same anatomy (summary, record header, four-cell strip with caption and qualifier on one mono line, a target tick on the progress bar, facts headers on charts). Weaker than Keel: the pace sparkline carries no reference line or hover value (basalt `Sparkline`), the deltas render in basalt's mono face, and the streak ticks carry no per-day tooltip.

- **r6** (lead review 1; own read of `…-r5` and `…-r5-all`, no reviewer pass). Changed: THIS WEEK compares Monday through today with last week to the same weekday from a 30-day day series, labelled `vs last week to {weekday}`, the meter caption reads `so far`, and the cell names `Mon–Sun, UTC`; the hour grid states `local time, current UTC{offset}` and rounds a half-hour zone to the hour in words; Totals gained a `Pace {overall} km/h · distance ÷ time` row next to the Pace cell's weighted mean; the streak footer counts the walked days in text; the target input takes its bounds from the same constant as the store field. Limit: the API returns the hour grid already summed across dates, so a walk from the other side of a DST change lands an hour off; fixing it needs per-walk timestamps from the API.

## Wave 21 friction

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `Sparkline` | a reference value (mean/target) and a hover readout | Pace cell: the weekly pace against the window average | end dot only; the footer states the measure |
| `DeltaBadge` | a sans face, or a `font` prop | km and km/h deltas in a strip cell | passes `format` + `polarity`; the mono face stays |
| `ChartCard` | a `subtitle` that stays visible at half width | median, longest and peak-hour facts | a `Facts` header in the card body (`facts.tsx`) |
| `BandStrip` | discrete labelled day cells and a `today` outline | Mon–Sun streak ticks | seven ticks hand-rolled in `strip.module.css` |
| `StatGroup variant="strip"` | caption, qualifier and an `action` slot on the caption line | the four-cell strip with a target popover | local `Strip` / `StripCell` |
| `EventList` | month grouping and `collapse` of repeats with a count | achievements | a local list over `collapseAchievements` / `groupByMonth` |
| record header | a `pulse` status | live / idle walk header | local `RecordHeader` with a CSS pulse (`raw-motion-value` waiver) |
| `EmptyState` | a compact one-row variant with an action | "No walks in {window}" | `tier="section"` with a `Button` action |
| `Heatmap` | a neutral single-metric ramp default and a tooltip label other than `Value` | walks by hour | passes `VX.muted` and explicit tooltip rows |
| `Heatmap` | tooltip without the bare `Value` row | walks by hour | the row stays beside `Walks` and `Distance` |
| `EmptyState` / heading face | a zero that is not slashed in the heading face | "No walks in the last 30 days" reads `3θ` | left as is |

- **r5** (reviewer on r4: record header, Totals and both page states pass; strip cells fail on blank height, chart facts and table on mono figures and four type sizes). Changed after it: the summary names the pace period, facts context is sans, achievements state `{n} unlocks in {m} titles`. Left: strip dead space (cells share the row height), table and heatmap type scales (basalt chrome), the slashed zero and the `Value` tooltip row (basalt-side).
