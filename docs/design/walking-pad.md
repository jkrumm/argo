# WalkingPad — concept

Route `/walking-pad` · `apps/dashboard/src/routes/walking-pad.tsx`, `apps/dashboard/src/features/walking-pad/` (`hero-stats.tsx`, `live-card.tsx`, `achievements-gallery.tsx`, `session-history.tsx`, `charts/`).

## Baseline verdict

Baseline: `.design-shots/baseline/walking-pad--dark--desktop.png`, crops `walking-pad--dark--01-volume.png` … `09-energy.png` (hero tiles), `10-card.png` (live/last-walk card), `11-daily-activity.png` … `15-time-of-day.png` (charts), `16-card.png` (session table). Production data, 2026-10-17, "Last 30 days" window; the last walk was 78 days ago, so the window holds zero sessions.

- **The default view is empty.** Nine tiles (`01`–`09`) show "0.00 km", "—", "0 days", "avg 0 m · best 0 m", "avg 0.00 km/h · best 0.00 km/h": zero-valued numbers and dashes, with the window's emptiness never named in one place. Five chart cards (`11`, `12`, `13`, `14`, `15`) are 300 px of centred "No walks in this window" text. About 60 % of the page height is empty regions.
- **Slop.** Tile subtitles that truncate mid-sentence ("Not enough prior data to compare …", "No walks in this window — last w…"); the "Streak" tile pairs "Best 6d" with "Momentum Steady" as two bare rows; a "1 metrics" filter chip; six filler-question subtitles ("How is each day adding up?", "How much did I walk each day?", "Am I walking faster over time?", "Am I keeping the habit alive week to week?", "Is the habit holding week to week?", "How far are my walks?", "When do I tend to walk?"). The section subtitle and the chart subtitle ask the same question twice.
- **The one rich surface is hidden.** `10-card` (idle card: "Last walk 78 d ago · 6.35 km in 1:30:32 · avg 4.2 km/h", 6.35 km / 10,482 steps / 379 kcal) is the only block that answers anything, and the 38-row achievements list (`walking-pad--dark--desktop.png`, right column) is a scrolling stack of near-identical rows ("3-day streak" repeated nine times).
- **History table** (`16-card`) is the right shape for session rows and is correct in structure (mono figures, units in cells) but repeats the unit "km/h", "kcal" in every cell.
- **Distance from bar: 5/5.** Highest of the three: the default state shows no data at all, and the encodings (nine tiles) assume a populated window.

## The question and the decision

- **Question on opening:** am I keeping the walking habit — how many days this week, how far, how fast — and what was the last session?
- **Decision:** walk today (and for how long/fast) to hold the week's target and the streak.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Window default | `GET /walking-pad/sessions/summary` · `sessions`; last walk from `GET /walking-pad/sessions?limit=1` · `data[0].ended_at` | State | 30-day window (`walkingStore` fallback `30d`) that is empty | Keep the `30d` fallback; when the window has `sessions` = 0, one empty-state row names it: "No walks in the last 30 days — last walk Jul 31, 78 days ago" with an action "Show 90 days" (the next preset in `WALKING_WINDOW_VALUES`: `7d 30d 90d 6m 1y all`; there is no 12-week preset) | The page's first impression is the data, not its absence | `empty-state` |
| Live / last session | `GET /walking-pad/live`; `GET /walking-pad/sessions?limit=1` · `data[0].{ended_at,distance_m,duration_s,avg_speed_kmh,steps,kcal}` | An entity with facts | Wide idle card with three stats | Record header: status dot + "Idle", facts line "last walk 78 d ago · 6.35 km · 1:30:32 · 4.2 km/h", stats right "10,482 steps · 379 kcal"; while live the same header shows a pulse and the current pace/distance in the figures | One row says what the pad is doing; keep the live branch | `record-header` |
| Weekly volume vs target | `/sessions/series?bucket=week` · `points[].distance_m` (Monday-keyed weeks): the last bucket is this week, the one before it is last week; the window-level `heroes` `volume` is not used here | Progress to a target + trend | Tile "0.00 km" + weekly bar chart (empty) | Strip cell "THIS WEEK": "12.4" + muted "km", delta text "+3.1 km vs last week", `Meter` bar to a weekly target (the target is a new user setting, none exists today; placeholder 15 km) with a tick, end captions "0" "15 km"; qualifier "Mon–Sun" | A habit is a progress-to-target; prior-period comparison is the delta | `metric-card-bar` |
| Pace | `/sessions/heroes` · `pace.{currentAvgKmh,priorAvgKmh,deltaKmh}`; sparkline from `/sessions/series?bucket=week` · `points[].avg_speed_kmh` (null buckets break the line) | Single value with a trend | Tile "—" | Strip cell "PACE": "4.2" + muted "km/h", delta "+0.3 km/h vs the prior 30 d", sparkline of the weekly distance-weighted average pace (one point per week bucket, not per session) with end dot; delta text "vs prior window" with the window named in the qualifier | A pace is read against its own history | `stat-strip` |
| Streak | `/sessions/heroes` · `streak.{currentDays,bestDays,walkedToday,momentum,sessionsThisWeek}`; the seven ticks come from `/sessions/series?bucket=day` over `7d` · `points[].sessions` (> 0 = filled; Mon–Sun, UTC days) | Part of a whole (days in week) | Tile "0 days" + Best/Momentum rows | Strip cell "STREAK": "4" + muted "days", seven-day ticks (Mon–Sun, filled = walked, today outlined) as a `BandStrip`, caption "best 6 d"; the momentum word is dropped (it is derived from the same days) | A streak is days in a row; the day strip shows which | `metric-card-bar` (segmented), `schedule-item` |
| Session totals | `/sessions/summary` · `sessions`, `duration_s`, `distance_m`, `steps`, `kcal`, `avg_session_min` | Single value with a trend ×5 | Six tiles "—" | One strip cell with three rows: "Sessions 9 · avg 5.6 km", "Time 9 h 12 min · avg 1:01", "Energy {3,420} kcal · {10,100} steps in the window"; no sparklines (they repeat the weekly chart) | The five totals are one reading; the tiles are one per number | `stat-cell` |
| Daily activity | `/sessions/series?bucket=day` · `points[].distance_m` | Status over time | Bar chart (empty) | `BandStrip`/`Bars` with one bar per day over the window, y = km, refLine at the daily mean; height 180 px; hidden when the window has 0 sessions | A walking day is binary-plus-size; per-day bars show the rhythm | `timeline-event` |
| Pace trend | `/sessions/series?bucket=week` · `points[].avg_speed_kmh` | Single value with a trend | Line (empty) | Merged into the Pace cell's sparkline; chart only behind a "Pace" `ViewTabs` entry on the weekly chart | Duplicate encoding | — |
| Weekly volume | `/sessions/series?bucket=week` · `points[].distance_m` | Single value with a trend | Bars (empty) | Keep `Bars`, one bar per week bucket of the selected window, neutral, current week accent, target refLine; this is the page's main chart; the "walks this week" count is `streak.sessionsThisWeek` | Right shape; add target | — |
| Session distance distribution | `/sessions/length-histogram?metric=distance` · `buckets[].{bucketStart,bucketWidth,sessions}` | Distribution | Histogram (empty) | Keep `Bars` histogram, axis-less 120 px, in a half-width card beside time-of-day; header "median {5.2} km, longest {7.0} km", both computed client-side from `GET /walking-pad/sessions` rows (`distance_m`), because the histogram returns only bucket counts | Skew is the reading | — |
| Time of day | `/sessions/hour-of-day` · `cells[].{dow,hour,sessions}` (the API buckets by UTC; the client shifts each cell to local time with the browser's zone offset before drawing, and says "local time" in the header), `totalSessions` | Distribution (hour × weekday) | Matrix (empty) | Keep the matrix as a 7×24 heat grid, 140 px; header "most walks {Tue 10:00} local time" | Right shape | — |
| Session history | `GET /walking-pad/sessions` (paginated) | Record facts in a table row | Table, unit in each cell | `BasaltDataTable` with units in the header ("Distance km", "Pace km/h", "Energy kcal"), mono right-aligned figures, `relative-time` in When with the date in a tooltip, pause count as an inline chip; keep pagination | Fewer repeated unit strings; rows scannable by shape | `table-row`, `table-header` |
| Achievements | `GET /walking-pad/achievements` · `title`, `description`, `unlocked_at`, `type` (38 rows) | Event sequence | Scrolling card, 11 visible, repeated rows | `EventList` day-grouped by month, collapsed repeats ("3-day streak ×9, last 87 d ago"), count in the heading "38 unlocked"; right column of the history row, max 6 visible plus "Show all" | Repeats are rhythm, not rows | `timeline-event` |

## Layout

**1440.**

1. Summary: "12.4 km this week in 3 walks; streak 4 d; pace 4.2 km/h, +0.3 vs the prior 30 days."
2. Record header (live / last walk).
3. `StatGroup variant="strip"` of 4 cells: This week (meter), Pace (sparkline), Streak (day strip), Totals (three rows).
4. Weekly volume `Bars` (full width, week buckets of the selected window, 240 px).
5. Two-column row: session-distance histogram | time-of-day grid.
6. Two-column row: history table (wide) | achievements `EventList` (narrow).
7. Daily rhythm chart goes into the weekly card behind a `ViewTabs` ("Weeks | Days"); the pace chart behind "Pace".

**390.** Strip cells stack in two columns of two (SPEC §6.5, never four squeezed); weekly chart 200 px; histogram and time-of-day stack; achievements collapse to 3 rows plus "Show all"; the history table folds to Date, Distance, Pace with a pinned first column.

**Charts: stay** weekly volume, histogram, time-of-day. **Change** daily activity (merged behind a tab), pace trend (into the strip), achievements (list → `EventList`). **Go** the nine KPI tiles, four of the five section subtitles, the standalone empty cards.

## Copy

Numbers in braces are illustrative placeholders for the format.

- Summary: "{12.4} km this week in {3} walks; streak {4} d; pace {4.2} km/h, {+0.3} vs the prior 30 days."
- Cells: "THIS WEEK · Mon–Sun", "PACE · avg 30 d", "STREAK · best {6} d", "TOTALS · 30 d"
- Record header idle: "Idle · last walk {78} d ago · {6.35} km · {1:30:32} · {4.2} km/h"
- Chart titles: "Weekly distance, last 30 days" (qualifier "target {15} km"); "Session distance, last 30 days" (qualifier "median {5.2} km"); "Walks by hour, last 30 days" (qualifier "peak {Tue 10:00}")
- Empty: "No walks in the last 30 days — last walk {Jul 31}, {78} days ago." Action "Show 90 days".
- Achievements heading: "Achievements" + count chip "{38}"; row "{3-day streak} ×{9} · last {87} d ago"
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
