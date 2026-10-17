# Usage Tracking — concept

Route `/usage-tracking` · `apps/dashboard/src/routes/usage-tracking.tsx`, `apps/dashboard/src/features/usage-tracking/` · API `GET /usage/headline`, `/usage/timeseries`, `/usage/breakdown`.

## Baseline verdict

Shots: `usage-tracking--dark--desktop.png`, crops `usage-tracking--dark--01-cost-30d.png` … `05-cache-hit-30d.png`, `06-cost-over-time.png`, `07-billing-split-cost.png`, `08-tokens-over-time.png`, `11-p95-latency.png`, `12-card.png`.

- Five bare `StatCard`s (crops 01–05) with no micro-visual. Each carries a long mono subtitle ("Last 7d $5183 · Max $12730 · IU $556 · OpenRouter $0.0028"), which is a row of numbers in one string. Cache hit is `98.4%` with no scale, so the reader cannot tell whether that is good.
- "Tokens over time" (crop 08) has a legend of roughly 170 entries, about 2000 px of wrapped swatches, between the chart and everything below it. The chart is unreadable; the legend is the page.
- Cost-over-time legend (crop 06) lists 15 sources; the donut (crop 07) shows a 96 / 4 split that a single bar says better, and its centre repeats the "Cost" card.
- Top projects (crop 12) is a table with a share column where a ranked bar list exists.
- Section titles "Cost", "Volume", "Health" and the card captions are bare nouns with no number.
- Fields in `usage_record` the page never reads: `cost_source` only (how a cost was derived: reported vs estimated). `sub_tool` is a group-by, `workspace` a filter, the token columns feed the tokens metric, `duration_ms` feeds p95, `machine` is a filter and group-by.

**Distance from bar: 4/5.** Real data and sensible metrics, but no dataset has an encoding chosen for its shape and one legend consumes the page.

## The question and the decision

Question: am I burning more than usual, and is any source or project responsible, or is anything failing?
Decision: which source or project to throttle, move to another billing plan, or investigate for errors this week.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today | Chosen | Reason | Keel |
|-|-|-|-|-|-|-|
| Cost, 30d | `headline.costUsd30d`, `costUsd7d`; `timeseries?metric=cost&grain=day&range=90d` | Single value with a trend | `$13286` + subtitle string | `StatCard` caption `COST · 30d`, value `$13,286`, delta `+12% vs prior 30d` (prior from the 90d series), axis-less daily sparkline with end dot | Daily history says whether 7d `$5,183` is normal | `metric-card.png` |
| Billing split | `headline.cost{Max,Iu,Openrouter}Billing30d` | Part of a whole, 2–6 parts | Donut + 3-row legend | `Meter` segments Max / IU / Other, captions under segments (`Max $12,730 · 96%`, `IU $556 · 4%`), no donut | One bar carries parts and total; donut spends a half-width card on two numbers | `metric-card-bar.png` |
| Tokens, 30d | `headline.tokens30d`, `sourcesActive`; `timeseries?metric=tokens` | Single value with a trend | `1673.3M` + "15 active sources" | Strip cell `TOKENS · 30d`, value `1.67` + muted `B`, sparkline, qualifier `15 sources` | Unit gets a symbol; sparkline replaces the subtitle | `stat-cell.png` |
| Error rate | `headline.errorRate30d`, `maxTs`; `timeseries?metric=errors&groupBy=outcome` | Status over time | `0.5%` + "Last event 1m ago" | Strip cell `ERRORS · 30d`, `0.5%`, a 30-cell `BandStrip` (day ok < 1% / warn 1–3% / bad > 3%, proposed thresholds, error ink only when earned) | Every day visible; runs of bad days read at once | `stat-strip.png` |
| p95 latency | `headline.p95Ms30d`; `timeseries?metric=latency_p95` | Single value with a trend | `31.95s` + "589,138 rows lifetime" | Strip cell `P95 · 30d`, `32.0 s` (muted `s`), sparkline with end dot; row count moves to the footer | Row count is not about latency | `metric-card.png` |
| Cache hit | `headline.cacheHitRatio30d`; `timeseries?metric=cache_ratio` | Single headline ratio, shape is the message | `98.4%` | Strip cell with ring `Meter` at 98.4 and a tick at 60 (the existing "good" threshold in `cache-hit-ratio.tsx`), caption `CACHE HIT · 30d` | Bounded ratio with a known target is exactly the ring case; the only ring on the page | `metric-card-gauge.png` |
| Cost by source over time | `timeseries?metric=cost&groupBy=source` | Part of a whole over time | Stacked area, 15-entry legend | Stacked area folded to top 6 sources + "Other" (neutral), legend replaced by the adjacent `BarList` (30d cost per source). Source / Machine / Billing switch stays | The ranked list is the legend and the ranking at once | `kanban-column.png` (count + total header) |
| Tokens by tool over time | `timeseries?metric=tokens&groupBy=sub_tool` | Part of a whole over time | Stacked area, ~170 legend entries | Same fold: top 6 + "Other"; adjacent `BarList` of top 8 tools; Tool / Model / Project / Source switch stays (the fold applies to every group-by) | 170 series cannot be separated by hue; length can rank them | — |
| Errors by source | `timeseries?metric=errors&groupBy=source` | Distribution over time | Stacked area, 12-entry legend | Axis-less `Bars`, error count per day, top 3 sources + Other, in the Health card | Counts of rare events read as bars, not areas | — |
| Latency + errors together | `timeseries` | Small multiples | Two separate cards | One composite Health card: p95 sparkline (left) and error bars (right), both axis-less with the first and last date as mono captions, divided by a hairline | Failures and latency are one question | `crew--dark--desktop.png` (agent card inner panel) |
| Top projects | `breakdown?dimension=project&metric=cost&limit=10` | Ranked list, top N | Table: project / cost / share | `BarList` 10 rows: label, bar on one scale, mono `$1,657`, trailing `12.5%` muted; header `Top projects · $13,286` | Rank reads by length | `table-row.png` |
| Row freshness | `headline.maxTs`, `recordsTotal` | Single value | Subtitle text | Footer line `589,138 records · last event 1m ago`, status dot red if > 30 min | Freshness is a fact about the feed, not a KPI | `status-pill.png` |

## Layout

1440: `PageBar` with the filter group (30d / Day / workspace / billing, unchanged). Summary sentence. Joined stat strip of 5 cells (Cost, Tokens, Errors, p95, Cache hit) with the billing `Meter` as a full-width second row of the Cost cell. Row: cost-by-source chart (8 cols) + Spend-by-source `BarList` (4). Row: tokens-by-tool chart (8) + tool `BarList` (4). Row: Health composite card (8) + Top projects `BarList` (4). Footer freshness line.

390: strip becomes a 2-column grid (Cache hit spans two); each chart is full width with its `BarList` below, capped at 5 rows with "Show all N"; Health card stacks p95 over errors.

Stay: the four chart kinds' hues (`USAGE_SOURCE`, `USAGE_BILLING`), the group-by switches, tooltips. Change: both big stacked areas (fold + BarList), hero cards, donut → `Meter`, table → `BarList`. Go: donut, the three chart legends, the subtitle strings.

## Copy

Format is binding; figures other than the 2026-10-17 baseline ones are illustrative. Money is always whole dollars with a thousands separator (`$13,286`, `$556`), never `k`-compacted; sub-dollar totals read `<$1`.

- Summary: `$13,286 over 30 days, $5,183 in the last 7 · 1.67B tokens · 0.5% errors · last event 1m ago`
- Cells: `COST · 30d` / `TOKENS · 30d` / `ERRORS · 30d` / `P95 · 30d` / `CACHE HIT · 30d`; qualifiers `+12% vs prior 30d`, `15 sources`, `3 bad days`, `+1.2 s vs prior`, `target 60%`
- Charts: `Cost per day · by source · $13,286` · `Tokens per day · by tool · 1.67B` · `Errors per day · 160 events` · `p95 latency · per day · 32.0 s`
- Lists: `Spend by source · 30d`, `Top projects · $13,286`; replaces "Cost / Volume / Health / Top projects" section titles
- Footer: `589,138 records · 15 sources · last event 1m ago`

## Upstream candidates

- `Meter` `{ value, max, target?, segments?: {label, value}[], shape: 'bar'|'ring', unit }`, maps to planned `Meter` (§4, wave 34).
- `BarList` `{ rows: {label, value, share?, hue?}[], format, max? }`, maps to planned `BarList`.
- `StatGroup variant="strip"` with a per-cell micro-visual slot, maps to planned strip.
- New: series-fold helper (`foldTopN(series, n, otherLabel)`) for stacked `CartesianChart` data. The top n are chosen once, by aggregate value over the active filtered range (the same totals the adjacent `BarList` ranks), and kept for every bucket; all remaining series sum into Other, so series identity is stable over time and the chart matches the list; every stacked chart with an open-ended group-by needs it.
- New: threshold-banded `BandStrip` preset from a daily series + thresholds (error days).

## Pass criteria

1. The page has no legend with more than 9 entries; stacked charts show at most 7 series including "Other".
2. Every number in the strip has a unit or symbol, a period, and a comparison or target; no cell is a bare number.
3. Cache hit renders a ring with a tick at 60; no other ring exists on the page.
4. The billing split is one segmented bar with captions; no donut remains.
5. Top projects is a bar list sorted by cost with a header that contains the total.
6. The summary sentence contains the 30d cost and the last-event age.
7. No filler section titles remain ("Cost", "Volume", "Health" on their own); no coloured left edges.
8. At 390 px the strip is 2 columns and no horizontal scroll appears.
