# Garmin Health — concept

Route `/garmin-health` · `apps/dashboard/src/routes/garmin-health.tsx`, `apps/dashboard/src/features/garmin-health/` (`hero-stats.tsx`, `charts/*`, `formulas.ts`).

## Baseline verdict

Baseline: `.design-shots/baseline/garmin-health--dark--desktop.png`, crops `garmin-health--dark--01-recovery.png` … `12-stress-levels.png` (production data, 2026-10-17, 30d window).

- **Slop.** The three hero cards (`01-recovery`, `02-fitness`, `03-training-load`) carry a coloured left edge (green, none, amber) and breakdown rows of bare numbers: "HRV 40 / Sleep 33 / RHR 25" has no unit and no scale, so 40 reads as an HRV of 40 ms. Fitness' headline value is a bare triangle glyph. Training load shows "0.69" with no zone band and the verdict word "Undertrained" at the card foot. Every chart card carries a filler-question subtitle: "What did I do?", "Am I moving enough?", "Is my body adapting?", "Am I overloading?", "Is load spiking or tapering?", "How well did I sleep?", "Net recovery or deficit?", "How calm was my day?".
- **Twelve cards, one rhythm.** 4 section headings + 9 full-width/half-width chart cards, all the same chrome, none of them says what the number means today. Three of them (`07-training-load-acwr`, `09-recovery-trend`, `12-stress-levels`) draw a filled zone band behind a line, which is correct; `05-daily-activity` (stacked bars + dashed 30d line + 3 colours) and `10-sleep-breakdown` (stacked bars, a score line and a second axis on one plot) are dual-axis plots that read as noise.
- **Headline numbers exist but are far from the figure.** The right side of each chart header has "53.2 VO2 -2 bpm RHR +1 ms HRV", "0.86 Optimal", "-53.4 -53 behind": the right facts, in a place nobody reads first.
- **Distance from bar: 4/5.** The data is rich and mostly encoded in the right shape (zone bands, stacked sleep stages); the top of the page, the copy and the chart density are what fail. No page summary, no scale on any KPI.

## The question and the decision

- **Question on opening:** am I recovered and is my load sensible today, and what is the trend behind it?
- **Decision:** train hard, train normal or rest today; and whether this week's load should go up or down.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Recovery score today | `GET /recovery/summary` `.recovery`, `.components.{hrv,sleep,rhr}` | Progress to a target (bounded ratio) + parts | StatCard "88", left edge, 3 bare rows | `Meter` bar 0–100 with ticks at 40 and 70 (the rest/push cut-offs) and a mark at the 7-day mean; value "88" + muted "/100"; caption "RECOVERY · today"; qualifier "7d mean 71"; below it three `BarList` rows `HRV 40 / 40`, `Sleep 33 / 35`, `RHR 25 / 25` in points of max, bar on a shared 0–40 scale | The score is a bounded ratio with named cut-offs; length on a track shows where it sits against push/rest without a verdict word. Contributors are parts of the whole | `metric-card-bar` (track + tick + end captions), `entity-card` (inner panel) |
| Fitness direction | `GET /fitness-direction/summary` `.rhrDelta .hrvDelta .vo2max .label` | Single value with a trend ×3 | Triangle glyph + 3 rows | Three small-multiple cells in one strip: "RHR −4 bpm" / "HRV +2 ms" / "VO2max 53.2 ml/kg/min", each with an axis-less `Sparkline` of the window and an end dot, delta as text colour only; caption "FITNESS · 14d regression" | Direction is a trend per signal; a glyph hides which signal moved. RHR down is good, so its delta takes the good colour although the sign is negative | `stat-strip` (cells with sparkline), `stat-cell` |
| Training load (ACWR) | `GET /training-load` `.points[].{acwr,acute,chronic,zone}` | Progress to a target (zoned) | StatCard "0.69", edge, Acute/Chronic rows | `Meter` bar 0–2.0 with three zones (under 0–0.8 / optimal 0.8–1.3 / over >1.5; 1.3–1.5 a neutral caution step) and a marker at 0.69; "0.69" + muted "ACWR"; end captions "0" "0.8 · 1.3" "2.0"; footer "acute 240 · chronic 347 kcal-eq"; caption "TRAINING LOAD · 7d ÷ 28d" | A ratio whose meaning is its zone; the marker position replaces the verdict word | `metric-card-bar` |
| Activities per day | `GET /activities/summary`, `GET /activities` | Part of a whole over time | Stacked bars by type, 20 days, legend | Keep `Bars` stacked by `type_key` (series `ACTIVITY.*`); header facts "20 active days · 32 h 42 min · 4.2 sessions/wk"; legend stays | The one chart where the stack is the point (type mix per day) | `timeline-event` (day rhythm) |
| Daily activity (MET) | `GET /daily-metrics/series` `moderate_intensity_min`, `vigorous_intensity_min`, `steps` | Part of a whole over time | Stacked bars + 30d line + zone band | Change to a single `Bars` of intensity minutes (moderate + 2×vigorous) with a refLine at the 150 min/week target pace (21.4/day); drop the 30d line and the three-way colour split; header "209 MET-min today · 30d mean 417" | One bar series with one target is readable; the three-hue stack carried no decision | `metric-card-bar` |
| Fitness trends | `GET /daily-metrics/series` `resting_hr`, `hrv_weekly_avg`, `vo2_max` | Single value with a trend ×3 | One chart, three z-score lines | Go: replaced by the strip's three sparklines above. Keep a full chart only behind the strip's "Trend" tab (`ViewTabs`) | Three sparklines answer "adapting?" with from → to deltas; the z-score chart answered nothing readable | `stat-strip` |
| ACWR series + divergence | `GET /training-load` `.points[]` | Status over time + zoned line | Two line charts, one with a −100…+100 divergence bar plot | Keep the ACWR line with its zone bands (`07`); merge divergence into a muted second panel under it as one `Bars` strip, 60 px high; header "ACWR 0.86 optimal · 12 of 30 days in zone" | Zone bands are right; the divergence plot needs only to read as "short load under long load" | `activity-item` |
| Recovery series | `GET /recovery/series` | Status over time | Line on three tinted bands (`09`) | Keep; header "recovery 67 avg · 14 of 30 days ≥ 70"; gaps stay gaps (the line breaks at null days) | Already the right shape; header needs facts | — |
| Sleep | `GET /daily-metrics/series` `deep/light/rem/awake_sleep_sec`, `sleep_score`, `sleep_duration_sec` | Part of a whole over time | Stacked bars + score line + right axis (`10`) | Stacked `Bars` (deep, REM, light, awake) in hours, no score line; header "8.2 h last night · score 95 · 30d mean 7.4 h"; score gets its own sparkline in the hero strip | Two units on one plot (h and score) is the defect | `entity-card` inner panel |
| Body battery | `GET /daily-metrics/series` `bb_charged`, `bb_drained`, `bb_highest`, `bb_lowest` | Part of a whole over time | Charged/drained bars + net line (`11`) | Keep diverging bars; header "+18 net charge · 30d mean +9 · high 96, low 14 today" | Diverging bars are the right shape for charge vs drain | — |
| Stress | `GET /daily-metrics/series` `avg_stress`, `avg_sleep_stress`, `max_stress` | Status over time | Line on three tinted bands (`12`) | Keep; header "24 avg stress · rest zone 21 of 30 days" | Right shape; header needs facts | — |
| Sync freshness | `GET /daily-metrics/sync-status` | Status | PageBar "Sync vor 19 Min." | Keep the `PageBar` sync control | Chrome, not data | — |

## Layout

**1440.** Page summary line (live numbers) → one joined strip of 3 composite cells (Recovery meter + contributors | Load meter | Fitness trio) → "Last 30 days" section with the chart pairs kept in a 2-column grid.

1. Summary: "Recovery 88/100 · load 0.69, under the 0.8 floor · RHR −4 bpm, HRV +2 ms over 14 d".
2. Strip (`StatGroup variant="strip"`): cell 1 Recovery (meter + 3-row `BarList`), cell 2 Training load (zoned meter, acute/chronic footer), cell 3 Fitness (3 sparkline rows). No coloured edge anywhere.
3. Section "Load": ACWR line with zones (stays), divergence strip (merged under it, was a card).
4. Section "Recovery and sleep": recovery line (stays), sleep stacked bars (changes), body battery (stays), stress (stays).
5. Section "Training": activities stacked bars (stays, full width), intensity minutes bars (changes). Daily-activity MET stack and fitness-trends chart go.

**390.** Strip cells stack one per row (Recovery, Load, Fitness); the contributors list stays under the meter. Charts go single column, 220 px high; legend collapses to the active series only. Section order is unchanged (page summary → strip → load → recovery → training).

**Charts: stay** activities, recovery series, ACWR, body battery, stress. **Change** sleep (score line off), daily activity (single bar series with a target). **Go** fitness-trends z-score chart (replaced by sparklines), the three-colour intensity stack.

## Copy

Numbers in braces are illustrative placeholders for the format, not measured values.

- Page summary: "Recovery {88}/100 · load {0.69} ACWR, {under} the 0.8 floor · RHR {−4} bpm and HRV {+2} ms over 14 d"
- Cells: "RECOVERY · today", "TRAINING LOAD · 7d ÷ 28d", "FITNESS · 14 d regression"
- Contributor rows: "HRV 40 / 40 pts", "Sleep 33 / 35 pts", "RHR 25 / 25 pts" (denominators are the weights 40/35/25 in `apps/api/src/lib/garmin-formulas.ts`; each row is points earned of its weight)
- Load footer: "acute {240} · chronic {347}"; zone chip text "UNDER · 0.8–1.3 optimal"
- Chart headers (title · facts): "Activities · {20} active days, {32 h 42 min}"; "ACWR · {0.86} in the optimal zone, {12} of {30} days"; "Recovery · {67} mean, {14} of {30} days ≥ 70"; "Sleep · {8.2 h} last night, {7.4 h} 30 d mean"; "Body battery · {+18} net, {+9} 30 d mean"; "Stress · {24} avg, {21} of {30} days in rest zone"; "Intensity minutes · {209} today, {150} min/wk target"
- Verdict words replace the filler subtitles: delete all eight; where a caption is needed it is the unit and period.
- Empty: "No sleep recorded {Oct 17} — watch not synced." (em dash for a single missing value)

## Upstream candidates

| Pattern | Props sketch | Planned export? |
|-|-|-|
| Zoned meter | `Meter bar min max zones={[{to,label}]} marker={v} ticks={[...]} caption unit` | `Meter` `segments` + target tick (SPEC §3, wave 34) — extend with `zones` + `marker` |
| Contributor list | `BarList rows={[{label,value,max}]} max` with per-row denominator caption | `BarList` (SPEC §4) — needs per-row max |
| Strip cell with sparkline | `StatGroup variant="strip"` cell `{caption, qualifier, value, unit, delta, sparkline}` | `StatGroup variant="strip"` (wave 35) |
| Chart facts header | `ChartCard` `facts: {value,unit,compare}[]` replacing title/subtitle | new (recipe in `basalt-design`, possibly a `ChartCard` prop) |

## Pass criteria

1. The first screen at 1440 shows a summary sentence containing three live numbers and no filler subtitle anywhere on the page.
2. Recovery shows "/100", the 40 and 70 ticks and a marker; each contributor has a bar and a denominator.
3. Training load shows the zone band with a marker; "0.69" is never the only thing on its card.
4. No card has a coloured left edge; no hue appears on a single-metric neutral chart.
5. Every chart header carries a value with unit, a comparison and the period.
6. Sleep chart has one unit (hours); daily-activity has one series and a target line.
7. At 390 the strip stacks to one column and nothing truncates a value.
8. A null reading shows "—", never 0, and the line breaks at gaps.
