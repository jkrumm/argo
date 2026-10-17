# Strength Tracker — concept

Route `/strength-tracker` (Charts / History tabs) — `apps/dashboard/src/routes/strength-tracker.tsx`, `features/strength-tracker/`; API `apps/api/src/routes/strength.ts` (`/workouts/summary/*`), `workouts.ts`.

## Baseline verdict

- `strength-tracker--dark--01-strength-scan.png`: the scan is the best surface on the page — one row per lift with e1RM, volume and INOL sparklines, momentum and a status dot. It is a table where a shape exists only partly: the sparklines are right, the `STATUS` dot and `▼ {velocity}%/d` cells are the right idea but carry no unit context or target.
- `02-card.png … 05-card.png` (per-lift summary): four cards of `Best / Sessions / Volume / PR date` — rows of bare numbers (`{volume} kg`, `{sessions}`), a coloured dot as the only identity, no history, no target.
- `06-estimated-1rm … 15-training-recovery-alignment.png`: ten chart cards, each with a filler-question subtitle ("Am I getting stronger?", "Is my training load sustainable?", "Is the trend accelerating?", "Which lifts are gaining most?", "Should I push, sustain, or rest today?"), and each section headed by another question. The charts themselves carry real shapes (zones, MEV/MAV/MRV lines, ACWR bands).
- `13-strength-balance.png`: the four ratio rows (`{ratio}` × 4) have a track and band but no lift names beside the figure and no "how far off" number.
- Duplicated reading of one fact: ACWR appears in `09` (`{acwr} ACWR · Optimal`), `INOL`, the alignment matrix and the readiness chart; four cards re-ask the same "am I recovered and loaded right" question with no synthesis.
- The right column (log form, timer, recent records, `16/17/18`) is a working tool and stays; `18-recent-records.png` is an undated-looking list of PRs.
- **Distance-from-bar: 3** — the analytics are real and well-shaped; the distance is copy (filler questions), the per-lift cards, and the absence of a top-of-page verdict.

## The question and the decision

- Question on opening: is training going up, is the load right, and is today a Push, Normal or Rest day?
- Decision: today's session intensity (Push / Normal / Rest), whether to deload, and which lift to prioritise.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Today's call | `/summary/heroes` `readiness` (`score`, `verdict`, `driver`), `/summary/deload-signal` (`verdict`, `activeSignals`) | Request that needs a decision | Two separate cards far apart | One decision-style card: `Push` verdict, `{score}/100` linear Meter with zone ticks at 40 and 70, muted `driver`, one line `deload signal: {n} active ({signal})`; no buttons. **Rule when the two disagree: the conservative verdict wins.** `deload-signal.verdict = deload` overrides readiness `Push` (title `Today: Deload`, the readiness Meter still shows `{score}/100 · Push` beneath as a fact), `monitor` keeps the readiness verdict and adds `monitor: <signal>`, `progress` changes nothing | Readiness is a bounded score with two thresholds; the zone ticks make the verdict visible | `decision-card`, `metric-card-gauge` |
| Per-lift state | `/summary/series-detailed`, `/summary/sparklines`, `/summary/records` | A set of KPIs about one record | Four bare-number cards | Four cells in one joined strip, one per lift: hero `{e1rm} kg` + muted `e1RM`, text delta `{delta} kg in 28d`, end-dot sparkline of e1RM, caption `PR {date}` | The history says whether the number is normal; one surface reads as one instrument | `stat-strip`, `stat-cell` |
| Scan table | `/summary/sparklines` (`e1rm`, `volume`, `inol`, `vel`, `dir`) | Single value with a trend, ×4 | Table with sparklines + status dot | Stays; `vel` shown as `{velocity} %/mo` with arrow (the API's `%/day` converted ×30 in one formatter; every velocity on the page is `%/mo`, matching the hero's `leaderVelocityPctPerMonth`), status dot gets a text label (`improving/stable/declining`), column header carries units | Already the right shape; add meaning, not chrome | `crew` (table rows), `table-row` |
| e1RM trajectory | `/summary/series-detailed` (`e1rm`, `ma30`, PR points) | Time series, 4 lines | Line chart + PR stars | Stays; header fact `Est. 1RM, 90 days · Deadlift {e1rm} kg ▲`; drop the subtitle question | Time series with markers is the right shape | `metric-card` (header) |
| Composite z-scores | `/summary/composite/:exerciseId` | Time series, 3 signals | Chart with ±3.5 σ axis, 3 lines | Stays but demoted below the fold in a collapsed `Section`; header `Velocity, tonnage, INOL vs 90-day baseline (σ)` | Hard to read at a glance; not part of today's decision | — |
| Weekly volume | `/summary/weekly-volume` (`warmup/work/drop/amrap`, `ma`) + `volumeLandmarks` | Part of whole over time | Stacked bars + MEV/MAV/MRV lines | Stays; header `Volume per week, 12 weeks · {volume}t this week · MAV {mav}t` | Stack + landmark lines answer sustainability | `metric-card-bar` |
| ACWR | `/summary/training-load` (`acwr`, `zone`) | Progress to a target (zone band) | Per-lift lines over coloured zones | Header becomes a zone Meter `{acwr}` on 0–2.0 with the optimal band 0.8–1.3 shaded; the multi-line chart stays beneath | Today's number against its zone beats finding the latest point in four lines | `metric-card-gauge` |
| INOL | `series-detailed.inol` | Time series + zones | Chart | Stays; header `INOL per session · {inol} · Hard (0.6–1.0 optimal)` | The zone legend becomes the header fact | — |
| Momentum | `series-detailed` (`e1rm`, `ma30`) + velocity | Time series | Two-panel chart | Stays; header `Velocity {velocity} %/mo` | — | — |
| Relative progression | `/summary/relative-progression` | Time series, normalised | Four lines | Stays; header `Since {date} · Bench {pct}%` | — | — |
| Strength balance | `heroes.balance.ratios` (`label`, `ratio`, `range`, `status`) | Progress to a target (range) | Track + band + tick | Rows become `Meter` with band: label `DL / Squat`, `{ratio}` mono, band `1.0–1.4`, status text `balanced` | Value, target and verdict on one line each | `metric-card-bar` |
| Readiness history | `/summary/readiness` | Time series + zones | 180-day line over zones | Stays; header `Adjusted readiness, 180 days · {score} · Push` | — | — |
| Alignment | `/summary/alignment` | 3×3 matrix | Coloured cells with counts | Demoted to `Section` collapsed by default; today's cell outlined | Diagnostic, not a daily read | — |
| Recent PRs | `/summary/records` | Event sequence | Dot + text list | `EventList`: day group, `Squat · Max weight`, mono `{weight} kg` right, lift dot kept as category | Day rhythm and right-pinned values | `timeline-event` |

## Layout

**1440.** Summary sentence under `PageBar`, then the page splits as today (main column + right tool column).

1. Summary: `Deadlift e1RM {e1rm} kg, {delta} kg in 28d · ACWR {acwr} optimal · readiness {score} Push`.
2. Row: Today's call card (left, 2/3) + per-lift strip (4 cells, below it spanning full width).
3. Scan table.
4. Sections reduced from five to four, each a precise noun: `Strength, 90 days` (e1RM + momentum), `Load, 12 weeks` (volume + ACWR + INOL), `Balance` (relative progression + ratios), `Readiness, 180 days`. Composite and alignment move into a collapsed `Diagnostics` section.
5. Right column unchanged: log form, timer, recent PRs as an `EventList`.

Charts that stay: e1RM, weekly volume, ACWR lines, INOL, momentum, relative progression, readiness. Changed: ratios (Meter rows), per-lift cards (joined strip), recent PRs (EventList). Moved: composite, alignment. Gone: the four per-lift cards, the filler subtitles.

**390.** Tool column (log, timer) drops below the verdict card; the lift strip becomes a 2×2 grid; the scan table scrolls its sparkline columns away and keeps lift, e1RM, status; charts stack, each 220 px tall; `Diagnostics` stays collapsed.

## Copy

Values are placeholders; the format is the contract.

- Section titles: `Strength, 90 days`, `Load, 12 weeks`, `Balance`, `Readiness, 180 days`, `Diagnostics`. No subtitles.
- Today's call: title `Today: Push`; facts `Readiness {score}/100 · driver {driver} · last session INOL {inol}` ; line `Deload signal: {n} active`.
- Lift cell: `{e1rm} kg  e1RM` / `{delta} kg in 28d` / `PR {date} · {n} sessions`
- Chart headers: `Est. 1RM, 90 days`, `Volume per week · {volume}t this week · MAV {mav}t`, `ACWR {acwr} · optimal 0.8–1.3`, `INOL per session · {inol} · hard`.
- Ratio row: `DL / Squat   {ratio}   balanced · band 1.0–1.4`.
- Empty (no workouts): `No workouts logged. Log a set in the form to start the 28-day trend.`
- Replaces: "Am I getting stronger on the lifts I care about?", "Am I loading smart or just hard?", "Are my sessions producing quality work?", "Are my lifts proportional?", "Is today a push, sustain, or rest day?" and all per-card question subtitles.

## Upstream candidates

- `StatGroup variant="strip"` (SPEC §4): four joined cells, each with value, delta and end-dot sparkline. Props: `cells: { caption, value, unit?, delta?, spark? }[]`.
- `Meter` with `band` (maps to `Meter`): `{ value, max, band?: [lo, hi], ticks?: number[], label }` for ACWR, readiness, ratios.
- `EventList` for PRs (maps to SPEC §4). Props as in calendar.
- Decision-summary card (recipe only per SPEC §4/D4; propose a component only once Warden and Strength converge on one anatomy).

## Pass criteria

1. The first row shows the readiness verdict (Push / Normal / Rest) with a Meter and its two zone ticks; no card is a bare number.
2. Every section title is a noun with a period (`Load, 12 weeks`); no subtitle ends in `?`.
3. Each lift cell shows value with unit, a delta with its period and an end-dot sparkline.
4. ACWR and readiness are shown against their zone bands at the top, not only inside a chart.
5. Strength-balance rows show lift pair, ratio and status text, not colour alone.
6. Composite and alignment are collapsed; nothing below the fold repeats a figure already in the summary sentence without adding a period.
7. The right tool column is unchanged functionally and `Recent records` is day-grouped.
8. At 390 no chart is wider than the viewport and the scan table keeps lift, e1RM and status.
