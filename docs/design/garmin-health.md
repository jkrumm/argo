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

Response keys are the camelCase fields the dashboard reads (`apps/api/src/routes/*.ts` response schemas), not DB columns. All endpoints take `?window=`.

| Dataset | Source (endpoint · keys) | Shape (SPEC §3) | Today | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Recovery score today | `GET /recovery` · `recovery`, `components.{hrv,sleep,rhr}` (weighted points: 0.40, 0.35, 0.25 of the score, `garmin-formulas.ts`); mean from `GET /recovery/series` · `points[].recovery` | Progress to a target (bounded ratio) + parts | StatCard "88", left edge, 3 bare rows | `Meter` bar 0–100 with ticks at 40 and 70 (the rest/push cut-offs in `recoveryActionLabel`) and a mark at the window mean; value "88" + muted "/100"; caption "RECOVERY · today"; qualifier "30 d mean {71}"; below it three `BarList` rows "HRV {40} / 40 pts", "Sleep {33} / 35 pts", "RHR {25} / 25 pts", bars on a shared 0–40 scale | A bounded ratio with named cut-offs: length on a track shows where it sits against push/rest without a verdict word. Contributors are parts of the whole | `metric-card-bar`, `entity-card` (inner panel) |
| Fitness direction | `GET /fitness-direction` · `signal`, `label`, `rhrDelta`, `hrvDelta`, `vo2max`; sparklines from `GET /daily-metrics/series` · `points[].restingHr`, `.hrv`, `.vo2Max` | Single value with a trend ×3 | Triangle glyph + 3 rows | Three rows in one strip cell: "RHR {−4} bpm", "HRV {+2} ms", "VO2max {53.2} ml/kg/min", each with an axis-less `Sparkline` with an end dot; delta in text colour only (RHR down is good, so it takes the good colour despite the minus sign); caption "FITNESS · 14 d regression"; qualifier is the `label` ("Improving") | Direction is a trend per signal; a glyph hides which signal moved | `stat-strip`, `stat-cell` |
| Training load (ACWR) | `GET /training-load` · `points[].{acwr,acute,chronic,zone,dailyLoad,divergence,divPos,divNeg}`; acute/chronic are EWMAs of the daily activity score in MET-min (7 d and 28 d half-lives) | Progress to a target (zoned) | StatCard "0.69", edge, Acute/Chronic rows | `Meter` bar 0–2.0 with zones under 0–0.8 / optimal 0.8–1.3 / caution 1.3–1.5 / danger >1.5 (the API's `zone` cut-offs) and a marker at the latest `acwr`; "0.69" + muted "ACWR"; end captions "0" "0.8 · 1.3" "2.0"; footer "acute {240} · chronic {347} MET-min/day"; caption "TRAINING LOAD · 7 d ÷ 28 d" | A ratio whose meaning is its zone; the marker position replaces the verdict word | `metric-card-bar` |
| Activities per day | `GET /activities/summary` · `totalsWindow.{sessions,minutes}`; `GET /activities` · `type_key`, `duration_sec`, `date` | Part of a whole over time | Stacked bars by type, 20 days, legend | Keep `Bars` stacked by `type_key` (series `ACTIVITY.*`); header "{20} sessions · {32 h 42 min}" in the window; legend stays | The one chart where the stack is the point (type mix per day) | `timeline-event` |
| Daily activity score | `GET /daily-metrics/series` · `points[].activityScore` (MET-min = 8 × vigorous min + 4 × moderate min + 0.03 × steps not already counted in intensity minutes) | Status over time | Stacked bars (walking/moderate/vigorous) + 30 d line + band | One measure, **MET-min**: a single neutral `Bars` series of `activityScore` with a `refLine` at 600 MET-min (the target in `ACTIVITY_TARGET_SCORE`), no 30 d line, no three-way colour split; header "{209} MET-min today · {35} % of 600 · 30 d mean {417}" | One bar series with one target is readable; the three-hue stack carried no decision and mixed units with the line | `metric-card-bar` |
| Fitness trends chart | — | — | One chart, three z-score lines | **Goes entirely.** The strip's three sparklines carry RHR, HRV and VO2max with from → to deltas; no tab, no fallback chart | Three z-scored lines answered "adapting?" less readably than three labelled deltas | `stat-strip` |
| ACWR series + divergence | `GET /training-load` · `points[].{acwr,zone,divPos,divNeg}` | Status over time + zoned line | Two line charts, one with a divergence bar plot | Keep the ACWR line on its zone bands (`07`); merge divergence under it as one `Bars` strip, 60 px high (`divPos` / `divNeg`); header "ACWR {0.86} optimal · {12} of {30} days in zone" | Zone bands are right; divergence needs only to read as "acute over/under chronic" | `activity-item` |
| Recovery series | `GET /recovery/series` · `points[].recovery` | Status over time | Line on three tinted bands (`09`) | Keep; header "recovery {67} mean · {14} of {30} days ≥ 70"; line breaks at null days | Right shape; header needs facts | — |
| Sleep | `GET /daily-metrics/series` · `points[].{deepSleepSec,remSleepSec,lightSleepSec,awakeSleepSec,sleepDurationSec,sleepScore}` | Part of a whole over time | Stacked bars + score line + right axis (`10`) | Stacked `Bars` (deep, REM, light, awake) in hours only, score line off; header "{8.2} h last night · score {95}/100 · 30 d mean {7.4} h". The score lives in this header, not in the strip | Two units on one plot (h and score) is the defect | `entity-card` inner panel |
| Body battery | `GET /daily-metrics/series` · `points[].{bbCharged,bbDrained,bbNet,bbHighest,bbLowest}` | Part of a whole over time | Charged/drained bars + net line (`11`) | Keep diverging bars; header "{+18} net · 30 d mean {+9} · high {96}, low {14} today" | Diverging bars are the right shape for charge vs drain | — |
| Stress | `GET /daily-metrics/series` · `points[].{stress,avgSleepStress}` | Status over time | Line on three tinted bands (`12`) | Keep (avg and overnight lines); header "{24} avg stress · rest zone {21} of {30} days" | Right shape; header needs facts | — |
| Sync freshness | `GET /daily-metrics/sync-status` | Status | PageBar "Sync vor 19 Min." | Keep the `PageBar` sync control | Chrome, not data | — |

## Layout

**1440.** Page summary line (live numbers) → one joined strip of 3 composite cells (Recovery meter + contributors | Load meter | Fitness trio) → "Last 30 days" section with the chart pairs kept in a 2-column grid.

1. Summary: "Recovery 88/100 · load 0.69, under the 0.8 floor · RHR −4 bpm, HRV +2 ms over 14 d".
2. Strip (`StatGroup variant="strip"`): cell 1 Recovery (meter + 3-row `BarList`), cell 2 Training load (zoned meter, acute/chronic footer), cell 3 Fitness (3 sparkline rows). No coloured edge anywhere.
3. Section "Load": ACWR line with zones (stays), divergence strip (merged under it, was a card).
4. Section "Recovery and sleep": recovery line (stays), sleep stacked bars (changes), body battery (stays), stress (stays).
5. Section "Training": activities stacked bars (stays, full width), daily activity score bars in MET-min with the 600 target (changes). The three-colour daily-activity stack and the fitness-trends chart go.

**390.** Strip cells stack one per row (Recovery, Load, Fitness); the contributors list stays under the meter. Charts go single column, 220 px high; legend collapses to the active series only. Section order is unchanged (page summary → strip → load → recovery → training).

**Charts: stay** activities, recovery series, ACWR, body battery, stress. **Change** sleep (score line off, score moves to the chart header), daily activity (one MET-min series with the 600 target). **Go** the fitness-trends z-score chart entirely (replaced by the strip's sparklines, no tab), the three-colour activity stack.

## Copy

Numbers in braces are illustrative placeholders for the format, not measured values.

- Page summary: "Recovery {88}/100 · load {0.69} ACWR, {under} the 0.8 floor · RHR {−4} bpm and HRV {+2} ms over 14 d"
- Cells: "RECOVERY · today", "TRAINING LOAD · 7d ÷ 28d", "FITNESS · 14 d regression"
- Contributor rows: "HRV 40 / 40 pts", "Sleep 33 / 35 pts", "RHR 25 / 25 pts" (denominators are the weights 40/35/25 in `apps/api/src/lib/garmin-formulas.ts`; each row is points earned of its weight)
- Load footer: "acute {240} · chronic {347} MET-min/day"; zone chip text "UNDER · optimal 0.8–1.3"
- Chart headers (title · facts): "Activities · {20} active days, {32 h 42 min}"; "ACWR · {0.86} in the optimal zone, {12} of {30} days"; "Recovery · {67} mean, {14} of {30} days ≥ 70"; "Sleep · {8.2} h last night, score {95}/100, {7.4} h 30 d mean"; "Body battery · {+18} net, {+9} 30 d mean"; "Stress · {24} avg, {21} of {30} days in rest zone"; "Daily activity · {209} MET-min today, {35} % of the 600 target, 30 d mean {417}"
- Verdict words replace the filler subtitles: delete all eight; where a caption is needed it is the unit and period.
- Empty: "No sleep recorded {Oct 17} — watch not synced." (em dash for a single missing value)

## Upstream candidates

| Pattern | Props sketch | Planned export? |
|-|-|-|
| Zoned meter | `Meter bar min max zones={[{to,label}]} marker={v} ticks={[...]} caption unit` | `Meter` `segments` + target tick (SPEC §3, wave 34) — extend with `zones` + `marker` |
| Contributor list | `BarList rows={[{label,value,max}]} max` with per-row denominator caption | `BarList` (SPEC §4) — needs per-row max |
| Strip cell with sparkline rows | `StatGroup variant="strip"` cell `{caption, qualifier, value, unit, delta, sparkline}` | `StatGroup variant="strip"` (wave 35) |
| Chart facts header | `ChartCard` `facts: {value,unit,compare}[]` replacing title/subtitle | new (recipe in `basalt-design`, possibly a `ChartCard` prop) |

## Pass criteria

1. The first screen at 1440 shows a summary sentence containing three live numbers and no filler subtitle anywhere on the page.
2. Recovery shows "/100", the 40 and 70 ticks and a marker; each contributor has a bar and a denominator.
3. Training load shows the zone band with a marker; "0.69" is never the only thing on its card.
4. No card has a coloured left edge; no hue appears on a single-metric neutral chart.
5. Every chart header carries a value with unit, a comparison and the period.
6. Sleep chart has one unit (hours) and carries the score in its header; daily activity has one series in MET-min and a 600 target line; no fitness-trends chart exists on the page.
7. At 390 the strip stacks to one column and nothing truncates a value.
8. A null reading shows "—", never 0, and the line breaks at gaps.
