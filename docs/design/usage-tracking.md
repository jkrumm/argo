# Usage Tracking — concept

Route `/usage-tracking` · `apps/dashboard/src/routes/usage-tracking.tsx`, `apps/dashboard/src/features/usage-tracking/` · API `GET /usage/headline`, `/usage/timeseries`, `/usage/breakdown`.

## Baseline verdict

Shots: `usage-tracking--dark--desktop.png`, crops `usage-tracking--dark--01-cost-30d.png` … `05-cache-hit-30d.png`, `06-cost-over-time.png`, `07-billing-split-cost.png`, `08-tokens-over-time.png`, `11-p95-latency.png`, `12-card.png`.

- Five bare `StatCard`s (crops 01–05) with no micro-visual. Each carries a long mono subtitle ("Last 7d ${cost_7d} · Max ${cost_max} · IU ${cost_iu} · OpenRouter ${cost_or}"), which is a row of numbers in one string. Cache hit is `{pct}%` with no scale, so the reader cannot tell whether that is good.
- "Tokens over time" (crop 08) has a legend of {n_series} entries, about 2000 px of wrapped swatches, between the chart and everything below it. The chart is unreadable; the legend is the page.
- Cost-over-time legend (crop 06) lists {n_sources} sources; the donut (crop 07) shows a {pct} / {pct} split that a single bar says better, and its centre repeats the "Cost" card.
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
| Cost, 30d | `headline.costUsd30d`, `costUsd7d`; `timeseries?metric=cost&grain=day&range=90d` | Single value with a trend | `${cost_30d}` + subtitle string | `StatCard` caption `COST · 30d`, value `${cost_30d}`, delta `{delta}% vs prior 30d` (prior from the 90d series), axis-less daily sparkline with end dot | Daily history says whether 7d `${cost_7d}` is normal | `metric-card.png` |
| Billing split | `headline.cost{Max,Iu,Openrouter}Billing30d` | Part of a whole, 2–6 parts | Donut + 3-row legend | `Meter` segments Max / IU / Other, captions under segments (`Max ${cost} · {pct}%`, `IU ${cost} · {pct}%`), no donut | One bar carries parts and total; donut spends a half-width card on two numbers | `metric-card-bar.png` |
| Tokens, 30d | `headline.tokens30d`, `sourcesActive`; `timeseries?metric=tokens` | Single value with a trend | `{tokens}M` + "{n} active sources" | Strip cell `TOKENS · 30d`, value `{tokens}` + muted `B`, sparkline, qualifier `{n} sources` | Unit gets a symbol; sparkline replaces the subtitle | `stat-cell.png` |
| Error rate | `headline.errorRate30d`, `maxTs`; `timeseries?metric=errors&groupBy=outcome` | Status over time | `{rate}%` + "Last event {age} ago" | Strip cell `ERRORS · 30d`, `{rate}%`, a 30-cell `BandStrip` (day ok < 1% / warn 1–3% / bad > 3%, proposed thresholds, error ink only when earned) | Every day visible; runs of bad days read at once | `stat-strip.png` |
| p95 latency | `headline.p95Ms30d`; `timeseries?metric=latency_p95` | Single value with a trend | `{p95}s` + "{n} rows lifetime" | Strip cell `P95 · 30d`, `{p95} s` (muted `s`), sparkline with end dot; row count moves to the footer | Row count is not about latency | `metric-card.png` |
| Cache hit | `headline.cacheHitRatio30d`; `timeseries?metric=cache_ratio` | Single headline ratio, shape is the message | `{pct}%` | Strip cell with ring `Meter` at the ratio and a tick at 60 (the existing "good" threshold in `cache-hit-ratio.tsx`), caption `CACHE HIT · 30d` | Bounded ratio with a known target is exactly the ring case; the only ring on the page | `metric-card-gauge.png` |
| Cost by source over time | `timeseries?metric=cost&groupBy=source` | Part of a whole over time | Stacked area, {n}-entry legend | Stacked area folded to top 6 sources + "Other" (neutral), legend replaced by the adjacent `BarList` (30d cost per source). Source / Machine / Billing switch stays | The ranked list is the legend and the ranking at once | `kanban-column.png` (count + total header) |
| Tokens by tool over time | `timeseries?metric=tokens&groupBy=sub_tool` | Part of a whole over time | Stacked area, {n_series} legend entries | Same fold: top 6 + "Other"; adjacent `BarList` of top 8 tools; Tool / Model / Project / Source switch stays (the fold applies to every group-by) | {n_series} series cannot be separated by hue; length can rank them | — |
| Errors by source | `timeseries?metric=errors&groupBy=source` | Distribution over time | Stacked area, {n}-entry legend | Axis-less `Bars`, error count per day, top 3 sources + Other, in the Health card | Counts of rare events read as bars, not areas | — |
| Latency + errors together | `timeseries` | Small multiples | Two separate cards | One composite Health card: p95 sparkline (left) and error bars (right), both axis-less with the first and last date as mono captions, divided by a hairline | Failures and latency are one question | `crew--dark--desktop.png` (agent card inner panel) |
| Top projects | `breakdown?dimension=project&metric=cost&limit=10` | Ranked list, top N | Table: project / cost / share | `BarList` 10 rows: label, bar on one scale, mono `${cost}`, trailing `{share}%` muted; header `Top projects · ${cost_30d}` | Rank reads by length | `table-row.png` |
| Row freshness | `headline.maxTs`, `recordsTotal` | Single value | Subtitle text | Footer line `{n} records · last event {age} ago`, status dot red if > 30 min | Freshness is a fact about the feed, not a KPI | `status-pill.png` |

## Layout

1440: `PageBar` with the filter group (30d / Day / workspace / billing, unchanged). Summary sentence. Joined stat strip of 5 cells (Cost, Tokens, Errors, p95, Cache hit) with the billing `Meter` as a full-width second row of the Cost cell. Row: cost-by-source chart (8 cols) + Spend-by-source `BarList` (4). Row: tokens-by-tool chart (8) + tool `BarList` (4). Row: Health composite card (8) + Top projects `BarList` (4). Footer freshness line.

390: strip becomes a 2-column grid (Cache hit spans two); each chart is full width with its `BarList` below, capped at 5 rows with "Show all N"; Health card stacks p95 over errors.

Stay: the four chart kinds' hues (`USAGE_SOURCE`, `USAGE_BILLING`), the group-by switches, tooltips. Change: both big stacked areas (fold + BarList), hero cards, donut → `Meter`, table → `BarList`. Go: donut, the three chart legends, the subtitle strings.

## Copy

Format is binding; figures are placeholders. Money is always whole dollars with a thousands separator, never `k`-compacted; sub-dollar totals read `<$1`.

- Summary: `${cost_30d} over 30 days, ${cost_7d} in the last 7 days · {tokens}B tokens · {rate}% errors in 30 d · last event {age} ago`
- Cells: `COST · 30d` / `TOKENS · 30d` / `ERRORS · 30d` / `P95 · 30d` / `CACHE HIT · 30d`; qualifiers `{delta}% vs prior 30d`, `{n} sources`, `{n} bad days`, `{delta} s vs prior`, `target 60%`
- Charts: `Cost per day · by source · ${cost_30d}` · `Tokens per day · by tool · {tokens}B` · `Errors per day · {n} events` · `p95 latency · per day · {p95} s`
- Lists: `Spend by source · 30d`, `Top projects · ${cost_30d}`; replaces "Cost / Volume / Health / Top projects" section titles
- Footer: `{n} records in total · {n} sources active in 30 d · last event {age} ago`

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

## Wave 21 build notes

- **API (additive, no schema change):** `GET /usage/headline` gained `costUsdPrior30d`, `tokensPrior30d`, `errorRatePrior30d`, `p95MsPrior30d` (the 30 d before the current window; `null` when that window would reach before the data floor, and `null` for a ratio with no rows). `GET /usage/timeseries` gained `metric=error_rate` (errors ÷ calls per bucket, `null` on a bucket with no calls). Both are needed for the strip's comparisons and the error band; neither existed.
- **Deviations from the concept:**
  - The strip is fixed at 30 d (the headline endpoint ignores the page filters); charts and lists follow range, grain, workspace and billing.
  - The p95 / errors Health card follows the page range. Errors are one bar series in the error colour with the top source named in the header (`{source} {pct}%`), not stacked by source: without a legend three category hues read as status.
  - Open-ended group-bys (tool, model, project) colour by rank, not by hash, so the six named series are six hues.
  - Header totals print the strip's figure when the page is unfiltered 30 d, so the page never carries two totals for one quantity (the buckets are cut a few minutes after the headline's rolling window).
  - The cache ring is a local SVG: `Meter shape="ring"` takes no target, and the ring needs the 60 % tick.

## Wave 21 rounds

Shots against production through `basalt-ui shot --api`; the production API did not yet serve the new fields in any round, so the Errors band and the prior-30 d comparisons were shot in their unavailable state.

| Round | Change | Reviewer verdict |
|-|-|-|
| r0 | Baseline: five bare `StatCard`s, donut, two legend-heavy stacked areas, table | not scored (baseline) |
| r1 | Strip with micro-visuals, billing `Meter`, folded charts + `BarList`s, Health card, footer. Chart cards had no shot anchors | not scored |
| r2 | Anchors on every card; sans captions with a period qualifier; segmented billing captions; `<1%` share; header totals = strip figure | fail on {n} components: sparkline without reference (basalt), mono list values (basalt), `{n}` contradicting totals, same-hue rows, ring fill unreadable, a `0 bad days` claim over an unavailable series, duplicate date axes, green bars on an error chart |
| r3 | Rank colours, single-hue error bars with the top source named, ring track softened, bad-days line dropped when unavailable, one date axis | fail on {n} components: all remaining fails basalt-side except period missing from the summary and chart titles, truncated tokens footer, mono freshness line, "30 D" in the billing caption |
| r4 | Periods added to the summary and chart titles, tokens footer split to three lines, freshness line in sans, billing caption qualifier | pass: strip cost, tokens, p95, cache, billing; page. Fail, argo-side: summary (`7` without a unit), errors cell (no cause on the unavailable state), tokens chart and list (two near-identical blue and two near-identical red hues), health (four font sizes), freshness (records without a period). Fail, basalt-side only: cost chart, cost list, projects (mono values, bars under values, info-icon focus ring, segmented-control radius nesting) |
| r5 | Rank palette reordered to six separable hues; `last 7 days`; `records in total` | not re-scored: the remaining argo-side fails are the errors-cell empty state (resolves once the API change deploys) and the health card's four font sizes |
| r6 | Review round 1 fixes: an absent `*Prior30d` field reads `prior unavailable`, a null one `no comparable prior 30 d`; error rate is `—` when the window has no calls (new `calls30d` headline field); the cost, tokens and p95 sparklines state their 30 d mean in text | not re-scored: shot against a production API that predates this PR, so every comparison shows `prior unavailable` |

## Wave 21 friction

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `Meter` (ring) | `target` tick | cache hit ring with a tick at the 60 % good threshold | local SVG ring in `usage-strip.tsx` |
| `Meter` (segments) | per-segment captions, `tone="muted"` | billing split Max / IU / Other with `{$} · {pct}%` under each segment | `startCaption={null}` plus a hand-built caption row; muted fill via `alpha(VX.muted, .35)` |
| `BarList` | per-row `hue` / `lead` swatch, proportional value face, bar that stops short of the value column | list that keys a stacked chart's series; values and shares in sans | swatch inside `secondary`; mono values and bars under values left as is |
| `Sparkline` | `reference` (mean / target line) | cost, tokens and p95 trends in the strip | end dot only; the comparison is stated in the footer |
| `Bars` / `AxisConfig` | hide an axis | axis-less error bars in the Health card | two ticks and a short date format |
| `ChartCard` | `facts` header (`value`, `unit`, `compare`) | `{what} per day · by {group} · {total} in {period}` as one title string | title string; the heading face slashes zeros in it |
| `StatGroup variant="strip"` | five cells plus a full-width row | headline strip | local CSS-module strip |
| series fold | `foldTopN` for stacked data | top 6 + Other for the cost and token charts | `foldTopN` in `features/usage-tracking/model.ts` (tested) |
| `BandStrip` | threshold-banded preset | daily error-rate days at 1 % / 3 % | `getBand` with `errorDayState` |

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. deltas without glyphs; unitless or mis-scaled sparkline readouts; raw date-time BandStrip headers; two near-identical token blues; health with no tooltips and all-red error bars; project labels crossing the bar end.
- **Fixed between rounds (#89):** `DeltaBadge` deltas with polarity (one per cell, none on an empty window), `$` / `M tokens` / seconds readouts, short-day headers, distinct hue families per visible key, health bars inked by the error-rate verdict joined by bucket key with a neutral zero-call state, thin project bars.
- **r2:** fail: cache-hit cell has no sparkline or delta; the billing footer is a bare `total {amount}`; health has one x tick and the worst verdict tiers are the palest bars; the freshness dot has no word; basalt: the BandStrip tooltip covers the hero, y tick labels inside the plot, the phone select inset.
- **Against Keel:** holds up, mostly; no headline sentence and lighter chart craft than Keel.
- **Open for Wave 24:** the four argo items above.

### Wave 24 fixes

- Headline: `SummaryLine` replaced by `PageSummary` (`page-headline.tsx`): sentence `{$} spent in 30 days, {$} in the last 7 days`, facts `{tokens} tokens · {rate} errors · {n} sources active · last event {age}`, aside is the freshness word (`fresh`, `stale {n} min`, `stale {n} h`, `no events`; `freshnessWord`, tested).
- `FreshnessFooter` and `footerLine` deleted: records total was the only fact the headline does not carry, and it was a count nobody acts on.
- Cache hit cell: the ring now sits beside a daily-ratio sparkline (`cache_ratio` timeseries) and a `DeltaBadge` in points, last 7 d against the 30 d window (`recentVsWindow`, tested); the footer names the 7 d mean next to the target. The headline carries no prior-30 d cache ratio, so the badge states its own period instead of "prior 30 d".
- Billing footer: `{$} total spend, last 30 d`.
- Health card: five x ticks on both charts; bar ink moved from the tinted `VX.warn` / `VX.bad` (an 8 % / 18 % wash) to `VX.warnSolid` / `VX.badSolid`, and the neutral tier is a 50 % muted, so severity now orders the salience. The strip's error band got the same solid inks.

| Export | Needed prop | argo case | What argo does instead |
|-|-|-|-|
| `VX.warn` / `VX.bad` | a solid-ink alias for series fills | bar and band fills read as the palest marks | `VX.warnSolid` / `VX.badSolid` per mark |
| `Meter` (ring) | `target` tick | cache hit ring | still the local `CacheRing`, now beside the trend |

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the `fresh` aside restates the facts line; the p95 sparkline is one spike then flat; the cache delta's `vs 30 d ratio` baseline is unclear beside a 30 d headline; the cost, tokens and health info tooltips narrate the drawing and show raw field names (`cost_usd`, `cache_read`); `{source} {pct}%` next to the error count has no stated meaning; warn and bad days differ by hue alone. Basalt: the latency axis has two ticks with the line through `100.0 s`; the errors tooltip covers the value; SegmentedControl indicator radius and the phone select inset.
- **Against Keel:** holds up — the best KPI band of the set; the stacked-area chart and the filter row dominate the fold.
