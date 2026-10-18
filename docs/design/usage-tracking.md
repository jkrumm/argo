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

| Dataset                   | Source                                                                           | Shape (SPEC §3)                             | Today                                   | Chosen                                                                                                                                                             | Reason                                                                                | Keel                                               |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Cost, 30d                 | `headline.costUsd30d`, `costUsd7d`; `timeseries?metric=cost&grain=day&range=90d` | Single value with a trend                   | `${cost_30d}` + subtitle string         | `StatCard` caption `COST · 30d`, value `${cost_30d}`, delta `{delta}% vs prior 30d` (prior from the 90d series), axis-less daily sparkline with end dot            | Daily history says whether 7d `${cost_7d}` is normal                                  | `metric-card.png`                                  |
| Billing split             | `headline.cost{Max,Iu,Openrouter}Billing30d`                                     | Part of a whole, 2–6 parts                  | Donut + 3-row legend                    | `Meter` segments Max / IU / Other, captions under segments (`Max ${cost} · {pct}%`, `IU ${cost} · {pct}%`), no donut                                               | One bar carries parts and total; donut spends a half-width card on two numbers        | `metric-card-bar.png`                              |
| Tokens, 30d               | `headline.tokens30d`, `sourcesActive`; `timeseries?metric=tokens`                | Single value with a trend                   | `{tokens}M` + "{n} active sources"      | Strip cell `TOKENS · 30d`, value `{tokens}` + muted `B`, sparkline, qualifier `{n} sources`                                                                        | Unit gets a symbol; sparkline replaces the subtitle                                   | `stat-cell.png`                                    |
| Error rate                | `headline.errorRate30d`, `maxTs`; `timeseries?metric=errors&groupBy=outcome`     | Status over time                            | `{rate}%` + "Last event {age} ago"      | Strip cell `ERRORS · 30d`, `{rate}%`, a 30-cell `BandStrip` (day ok < 1% / warn 1–3% / bad > 3%, proposed thresholds, error ink only when earned)                  | Every day visible; runs of bad days read at once                                      | `stat-strip.png`                                   |
| p95 latency               | `headline.p95Ms30d`; `timeseries?metric=latency_p95`                             | Single value with a trend                   | `{p95}s` + "{n} rows lifetime"          | Strip cell `P95 · 30d`, `{p95} s` (muted `s`), sparkline with end dot; row count moves to the footer                                                               | Row count is not about latency                                                        | `metric-card.png`                                  |
| Cache hit                 | `headline.cacheHitRatio30d`; `timeseries?metric=cache_ratio`                     | Single headline ratio, shape is the message | `{pct}%`                                | Strip cell with ring `Meter` at the ratio and a tick at 60 (the existing "good" threshold in `cache-hit-ratio.tsx`), caption `CACHE HIT · 30d`                     | Bounded ratio with a known target is exactly the ring case; the only ring on the page | `metric-card-gauge.png`                            |
| Cost by source over time  | `timeseries?metric=cost&groupBy=source`                                          | Part of a whole over time                   | Stacked area, {n}-entry legend          | Stacked area folded to top 6 sources + "Other" (neutral), legend replaced by the adjacent `BarList` (30d cost per source). Source / Machine / Billing switch stays | The ranked list is the legend and the ranking at once                                 | `kanban-column.png` (count + total header)         |
| Tokens by tool over time  | `timeseries?metric=tokens&groupBy=sub_tool`                                      | Part of a whole over time                   | Stacked area, {n_series} legend entries | Same fold: top 6 + "Other"; adjacent `BarList` of top 8 tools; Tool / Model / Project / Source switch stays (the fold applies to every group-by)                   | {n_series} series cannot be separated by hue; length can rank them                    | —                                                  |
| Errors by source          | `timeseries?metric=errors&groupBy=source`                                        | Distribution over time                      | Stacked area, {n}-entry legend          | Axis-less `Bars`, error count per day, top 3 sources + Other, in the Health card                                                                                   | Counts of rare events read as bars, not areas                                         | —                                                  |
| Latency + errors together | `timeseries`                                                                     | Small multiples                             | Two separate cards                      | One composite Health card: p95 sparkline (left) and error bars (right), both axis-less with the first and last date as mono captions, divided by a hairline        | Failures and latency are one question                                                 | `crew--dark--desktop.png` (agent card inner panel) |
| Top projects              | `breakdown?dimension=project&metric=cost&limit=10`                               | Ranked list, top N                          | Table: project / cost / share           | `BarList` 10 rows: label, bar on one scale, mono `${cost}`, trailing `{share}%` muted; header `Top projects · ${cost_30d}`                                         | Rank reads by length                                                                  | `table-row.png`                                    |
| Row freshness             | `headline.maxTs`, `recordsTotal`                                                 | Single value                                | Subtitle text                           | Footer line `{n} records · last event {age} ago`, status dot red if > 30 min                                                                                       | Freshness is a fact about the feed, not a KPI                                         | `status-pill.png`                                  |

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

| Round | Change                                                                                                                                                                                                                                                                | Reviewer verdict                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| r0    | Baseline: five bare `StatCard`s, donut, two legend-heavy stacked areas, table                                                                                                                                                                                         | not scored (baseline)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| r1    | Strip with micro-visuals, billing `Meter`, folded charts + `BarList`s, Health card, footer. Chart cards had no shot anchors                                                                                                                                           | not scored                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| r2    | Anchors on every card; sans captions with a period qualifier; segmented billing captions; `<1%` share; header totals = strip figure                                                                                                                                   | fail on {n} components: sparkline without reference (basalt), mono list values (basalt), `{n}` contradicting totals, same-hue rows, ring fill unreadable, a `0 bad days` claim over an unavailable series, duplicate date axes, green bars on an error chart                                                                                                                                                                                           |
| r3    | Rank colours, single-hue error bars with the top source named, ring track softened, bad-days line dropped when unavailable, one date axis                                                                                                                             | fail on {n} components: all remaining fails basalt-side except period missing from the summary and chart titles, truncated tokens footer, mono freshness line, "30 D" in the billing caption                                                                                                                                                                                                                                                           |
| r4    | Periods added to the summary and chart titles, tokens footer split to three lines, freshness line in sans, billing caption qualifier                                                                                                                                  | pass: strip cost, tokens, p95, cache, billing; page. Fail, argo-side: summary (`7` without a unit), errors cell (no cause on the unavailable state), tokens chart and list (two near-identical blue and two near-identical red hues), health (four font sizes), freshness (records without a period). Fail, basalt-side only: cost chart, cost list, projects (mono values, bars under values, info-icon focus ring, segmented-control radius nesting) |
| r5    | Rank palette reordered to six separable hues; `last 7 days`; `records in total`                                                                                                                                                                                       | not re-scored: the remaining argo-side fails are the errors-cell empty state (resolves once the API change deploys) and the health card's four font sizes                                                                                                                                                                                                                                                                                              |
| r6    | Review round 1 fixes: an absent `*Prior30d` field reads `prior unavailable`, a null one `no comparable prior 30 d`; error rate is `—` when the window has no calls (new `calls30d` headline field); the cost, tokens and p95 sparklines state their 30 d mean in text | not re-scored: shot against a production API that predates this PR, so every comparison shows `prior unavailable`                                                                                                                                                                                                                                                                                                                                      |

## Wave 21 friction

| Export                      | Needed prop                                                                                      | argo case                                                               | What argo does instead                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Meter` (ring)              | `target` tick                                                                                    | cache hit ring with a tick at the 60 % good threshold                   | local SVG ring in `usage-strip.tsx`                                                        |
| `Meter` (segments)          | per-segment captions, `tone="muted"`                                                             | billing split Max / IU / Other with `{$} · {pct}%` under each segment   | `startCaption={null}` plus a hand-built caption row; muted fill via `alpha(VX.muted, .35)` |
| `BarList`                   | per-row `hue` / `lead` swatch, proportional value face, bar that stops short of the value column | list that keys a stacked chart's series; values and shares in sans      | swatch inside `secondary`; mono values and bars under values left as is                    |
| `Sparkline`                 | `reference` (mean / target line)                                                                 | cost, tokens and p95 trends in the strip                                | end dot only; the comparison is stated in the footer                                       |
| `Bars` / `AxisConfig`       | hide an axis                                                                                     | axis-less error bars in the Health card                                 | two ticks and a short date format                                                          |
| `ChartCard`                 | `facts` header (`value`, `unit`, `compare`)                                                      | `{what} per day · by {group} · {total} in {period}` as one title string | title string; the heading face slashes zeros in it                                         |
| `StatGroup variant="strip"` | five cells plus a full-width row                                                                 | headline strip                                                          | local CSS-module strip                                                                     |
| series fold                 | `foldTopN` for stacked data                                                                      | top 6 + Other for the cost and token charts                             | `foldTopN` in `features/usage-tracking/model.ts` (tested)                                  |
| `BandStrip`                 | threshold-banded preset                                                                          | daily error-rate days at 1 % / 3 %                                      | `getBand` with `errorDayState`                                                             |

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

| Export               | Needed prop                        | argo case                                   | What argo does instead                            |
| -------------------- | ---------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `VX.warn` / `VX.bad` | a solid-ink alias for series fills | bar and band fills read as the palest marks | `VX.warnSolid` / `VX.badSolid` per mark           |
| `Meter` (ring)       | `target` tick                      | cache hit ring                              | still the local `CacheRing`, now beside the trend |

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the `fresh` aside restates the facts line; the p95 sparkline is one spike then flat; the cache delta's `vs 30 d ratio` baseline is unclear beside a 30 d headline; the cost, tokens and health info tooltips narrate the drawing and show raw field names (`cost_usd`, `cache_read`); `{source} {pct}%` next to the error count has no stated meaning; warn and bad days differ by hue alone. Basalt: the latency axis has two ticks with the line through `100.0 s`; the errors tooltip covers the value; SegmentedControl indicator radius and the phone select inset.
- **Against Keel:** holds up — the best KPI band of the set; the stacked-area chart and the filter row dominate the fold.

### Wave 25 fixes

- Headline aside: the `fresh` word is gone (the facts line already carries `last event {age}`); the aside appears only as `feed stale {age}` in warn/bad ink.
- p95 cell: the one-spike sparkline is dropped for facts: slowest day `{s} s, {date}` (`peakOf`, tested), mean daily p95, and the delta badge.
- Cache delta: the badge period reads `last 7 d vs 30 d`, naming both windows.
- Cost, tokens and health info tooltips rewritten as plain-word definitions; no raw field names.
- Error events label: `{pct} from {source}` (`topSourceNote`, tested) says the percent is of error events.
- Warn vs bad: the errors cell footer words both (only the kinds that occurred, e.g. `{n} warn days (1%–3%), {n} bad day (> 3%)`, else `no day above 1%`; `errorDaysLine`, tested), so the strip no longer separates them by hue alone.

| Export      | Needed prop / default                         | argo case                                                | What argo does instead                 |
| ----------- | --------------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| `BandStrip` | per-state glyph or text channel inside a cell | warn and bad days differ by hue alone in the strip cells | a worded count line in the cell footer |

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail (page passes). Fixed: no `fresh` aside, no one-spike sparkline, tooltips in plain words with no raw field names. Open: the p95 cell is now blank (`emptyRatio` ≈ 0.45) with no history, and `p95 {a} s` beside `30 d mean daily p95 {b} s` is undefined; warn and bad days still hue-only in the strip itself (the footer words them); the partial current day drawn as a drop; `last 7 d mean` restates the delta; donut + scale-less sparkline encode the cache rate twice; `Other` is the largest tokens bucket; raw tool identifiers in the tokens list. Basalt: `100.0 s` axis label over the line; `phoneSelect` padding 10.67.
- **Against Keel:** close (was holds up) — Keel's cells carry their scale or target top-right.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: the p95 cell draws a trend against a dashed reference (no longer blank); one p95 reading with a labelled reference; no `last 7 d mean` restatement; the cache rate encoded once; `Other` no longer the largest bucket; the page on one full-days basis (UTC days). Carried: warn/bad days hue-only inside the strip (basalt `BandStrip`); the cost chart still drops for the partial current day; tool labels keep a raw separator. **New:** the p95 and cache info tooltips narrate the drawing (`the dashed line…`); the p95 footer splits `30 d` at 1440. Unscored: the 30-day spend printed five times and the token total four times; two greys in the health card told apart by tone alone.
- **Against Keel:** close.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail (no new defect). Fixed: p95 and cache tooltips are definitions; `30 d` kept whole; the cost chart keeps the partial day consistently; no raw tool separator; the 30-day spend and token totals printed once; one neutral grey in the health card. Carried: warn/bad days hue-only in the errors strip (basalt `BandStrip`). Unscored: the errors footer orphans `(> 3%)` at 1440; the p95 `slowest day` splits its date at 390; the errors band ticks `DD.MM` vs `{day} {Mon}`.
- **Against Keel:** close — the best KPI band of the set.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the errors footer keeps `(> 3%)` with its phrase. Carried: warn/bad days hue-only (basalt `BandStrip`); the p95 `slowest day` date still splits at 390; band ticks `DD.MM` vs `{day} {Mon}` (basalt `BandStrip` has no tick formatter). **New:** the error chart's `0` tick under the first bar (thin `BarList`/axis on 2.21.0). Unscored: the headline's 7 d spend window matches no cell; `{n} B` vs `{n}M` in one cell; the errors tooltip covers the hero and gives no rate, the cache tooltip hides its value (basalt); the latency line through the top tick label; a 10.67 px phone-select inset (basalt).
- **Against Keel:** close — still the best KPI band of the set; the headline window disagrees with it.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the headline `{n} calls in the last 30 d` (spend only in the Cost cell, the window matches); one seconds format; the p95 date no longer splits. Carried: warn/bad days hue-only, band ticks `DD.MM`, the error chart's `0` tick under the first bar, the 10.67 px phone-select inset (all basalt); the p95 line still through the top tick label (the `autoPad` headroom does not show); `{n} B` vs `{n} M` in the Tokens cell. **New:** the Tokens footer orphans `days`. Unscored: the tokens tooltip lists zero-value series and mixes `k` with `M`; the Errors footer `vs {r} prior 30 d` repeats the delta's baseline.
- **Against Keel:** close — still the best KPI band of the set, and the headline now agrees with it.

### Wave 30 fixes

- **Tokens footer orphans `days`:** fixed — `full days` is glued with `NBSP` in the shared mean line (Cost and Tokens).
- **`{n} B` vs `{n} M` in the Tokens cell:** partly fixed — mean and peak per day share one magnitude (`tokensFormatterFor`, taken from the larger). The headline stays in its own magnitude: it is the 30 d total, a different quantity from a per-day figure, and in `M` it would read as a long number.
- **Tokens tooltip magnitudes:** fixed — the chart's axis and every tooltip row use one magnitude, taken from the largest bucket total; a non-zero row never prints as zero (two significant digits below 1 of the unit, `<0.01` below that).
- **Tokens tooltip zero rows:** not fixed — basalt row. `StackedArea` drops a stack row where any band is `null`, and the per-series `tooltip` flag is static, so there is no per-datum filter and no honest way to omit a zero without breaking the stack.
- **Errors footer repeats baseline:** fixed — the badge carries `prior 30 d`; the footer now reads `was {r}`.
- **p95 line through the top tick:** not fixed — no y-domain headroom prop set; left to basalt.

### Wave 30 round (`w30-r1`, live after #122–#125 on basalt-ui 2.21.0)

- **Reviewer:** fail (no new argo defect). Fixed: the Tokens footer keeps `full days` together; per-day mean and peak share one unit; the tokens axis and tooltip rows share one unit; the Errors footer reads `was {r}`. Carried (basalt): warn/bad days hue-only and `DD.MM` band ticks; the p95 line through the top tick label; the error chart's `0` tick under the first bar; the tokens tooltip lists zero-value series (`0 M` rows — unverified as true zeros from pixels; `StackedArea` has no per-datum row filter). Unscored: the cost sparkline readout prints cents against the page's whole-dollar rule; `{m}%` unspaced here while Astro prints `{m} %`.
- **Against Keel:** close — still the best stat strip of the set.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** fail. Fixed: the cost sparkline readout in whole dollars; percent spelled `{m} %` like Astro; the p95 line clears the top tick; the errors chart's `0` tick no longer under the first bar (2.22 gutter ticks); the single-series p95 chart draws no legend. **New:** latency ticks print `{n}.0 s` (2.22 ticks, basalt); token rows mix precision (`0.0{x} B` beside `0.{xx} B`, argo). Carried: the errors band's `!`/`×` glyphs are set but too small to read at this cell width, so warn vs bad is still hue-only (basalt); `DD.MM` band ticks; tooltip zero rows (`StackedArea`); the health bars' three tiers by hue (named in the legend). No lost fact.
- **Against Keel:** close — still the best stat strip of the set.

### Wave 32 fixes

- **Shot states:** `health` declares `empty`, and every card (`cost-chart`, `cost-list`, `health`, `projects`) renders its real empty branch (an empty series/breakdown substituted where each query is read — the same branch a window with no rows shows). `loading` and `error` are not declared: the route loader awaits the headline, so production shows the route pending screen / crash screen, not a card state.
- **Token precision:** one rule per column — one decimal from 1 of the unit up, two decimals below it (`0.05 B`, `0.50 B`, `0.12 B`, `1.8 B`), never a mix of significant-digit counts.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail. Fixed: token rows follow one precision rule (`0.{xx}` below 1 of the unit, one decimal from 1, decimal-safe at the 0.95 boundary); `empty` declared and every card renders its empty branch. **New (argo, empty state):** the cost and tokens lists and the projects card say `No data in this window` (banned `No data`, no action); the cost and tokens charts and the latency half of health fall back to ChartCard's `No data` because argo passes no `empty` label; under `empty` the strip still prints its 30 d figures (the strip must empty too); the short empty list card leaves its grid cell grey beside the full-height chart. Carried (basalt): the view-switch indicator's radius within 3 px of its card (`craft-1/nested-radius-step`); `{n}.0 s` / `{n}.0 M` ticks; `BandStrip` hue-only states and `DD.MM` ticks; tooltip zero rows; the band tooltip over the footer. No lost fact.
- **Against Keel:** close — still the best stat strip of the set; Keel's empty surfaces never fall back to `No data`.

### Wave 33 fixes (round 12)

- **One empty wording:** `No usage ingested in this window — the usage-tracker pushes every 15 min, or widen the range` on the cost and tokens lists, the projects card, the cost and tokens charts' `empty` label, the billing footer (`in the last {n} d`, without the range clause: the strip is fixed at 30 d) and, with no calls at all, the whole health card (one `empty` state, no `0 error events` beside a dash) (with a billing / workspace filter active the cause is the filter: `No usage matches these filters in this window — clear a filter or widen the range`; the health card judges rows by value, since empty days come back as null buckets: no calls → the window wording, calls but under two latency days → `A line needs latency on two {days}`, calls without errors → `No errors in this window`). The tracker's cadence is the ingest route's documented one.
- **Strip empties with its charts:** the summary and the strip read one headline hook (`use-headline.ts`); under `empty` it substitutes a window with no calls, and a real window with `calls30d` of 0 does the same. Every cell then reads `No usage ingested` (the cell `empty` state, no readings), and the billing footer carries the cause and next step (`No usage ingested in the last {n} d — …`).
- **Short list card:** the list and projects cards fill their grid cell (`height: 100%`), so they align with the chart beside them.
- **Basalt, no workaround:** `ViewTabs` radius in the header, `{n}.0` ticks, `BandStrip` glyphs, `DD.MM` ticks, `StackedArea` zero rows, the 390 2 + 1 strip.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail. Fixed: one filter-aware wording (`No usage ingested in this window — … or widen the range`, `No usage matches these filters …` under a filter) on the lists, projects, both charts (ChartCard `empty` labels now passed) and the latency half; the strip empties with the charts; the list cards fill their grid cell. **New (argo):** under `empty` the health card's errors half prints `0 error events · {n} d` beside latency's `—` — a false zero, and the wording appears twice in one card; the empty lists and projects card set their message at the top of an ~80 % blank card while the chart beside centres it; the billing footer drops `or widen the range` (two wordings for one gap); at 1440 the tokens chart ends short of the list beside it. Carried (basalt): the `ViewTabs` indicator radius within 3 px of its control; `BandStrip` hue-only warn/bad days; `{n}.0` ticks; `DD.MM` band ticks; `StackedArea` zero rows; the band tooltip over the footer. No lost fact.
- **Against Keel:** close at rest (still the best stat strip of the set); Keel's empty surfaces centre a title, a reason and an action.

### Wave 34 round (`w34-r1`, live after #144–#147 on basalt-ui 2.22.0; `w34-r2` after #148)

- **Reviewer:** fail (basalt rows; argo P2/P3). Fixed: under `empty` the health card says its gap once (no `0 error events` beside a dash) and a real latency line is never hidden; lists, projects, both charts and health share one filter-aware wording; the fixed-30 d billing footer keeps no range clause (by decision — the strip ignores the range); the tokens card fills its 1440 grid cell; the 390 empties centre. Partly / carried (basalt): at 1440 the empty lists centre in `ChartCard`'s placeholder height, not the card (~lower half blank). **New (argo):** P2 — on the empty screen one sentence appears six times plus `No usage ingested` in five strip cells ("one wording per gap" against "no sentence repeated on one screen"); P3 — the tokens card stretched but the plot keeps its height (~80 px band under the axis). Carried (basalt): `ViewTabs` radius, `BandStrip` hue-only days, info tooltips, `StackedArea` zero rows, decimal ticks, the 390 2 + 1 strip. Unscored: the health card ends ~200 px above projects at 1440; the delta sits on the hero line in two cells and below it in another. No lost fact.
- **Against Keel:** close — the strip matches Keel's metric-card anatomy; Keel leaves no band under a plot and no top-set empty.

### Wave 35 round (`w35-r1`, live after #149–#151 on basalt-ui 2.22.0)

- **Reviewer:** pass (basalt rows plus one argo P3). Fixed (confirmed): on the empty screen the full sentence appears once, on the 30 d billing footer, and every other surface (strip cells, both charts, both lists, health, projects) reads `No usage ingested` — never both forms on one surface. Unverified: the filtered pair (no filtered shot). Carried (argo, P3): the leading sentence names cause and cadence but no explicit step (the range clause dropped by decision — the strip ignores the range). Carried (basalt): the empty lists' and projects' top-set message in `ChartCard`'s placeholder height, the tokens `fill` band, decimal latency ticks, `/bin/zsh` / `0 M` tooltip rows, hue-only error days, the info tooltip over the hero. Unscored: the delta on the hero line in some cells and below it in others. No lost fact.
- **Against Keel:** close — Keel leaves no band under a plot and no top-set empty.
- **Re-score `w35-r2` (after basalt-ui 2.23.0, #152):** pass on the page; cost / tokens charts fail on one basalt P1 — the `ViewTabs` indicator radius is now 3 (the nested step passes, but 3 is off the radius scale; the same form as the Alert × `Code` row). Closed by 2.23: whole-step latency ticks (`0 s / 100 s`). Not closed (basalt): `$0` / `0 M` tooltip rows; the lists' / projects' top-set empty in `ChartCard`'s placeholder; hue-only warn/bad days (no glyph or notch visible at the band's 6 px cells); the tokens `fill` band. New (basalt, P3): strip footers ragged across cells; one component spells the month `Sept` (band ticks) and `Sep` (readout). The `30 d` qualifier now wraps to its own line at ~227 px without truncating. No lost fact.

### Wave 36 round (`w36-r1`, live after #153–#155 on basalt-ui 2.23.0; `w36-r2` after #156–#158)

- **Reviewer (`w36-r1`):** pass on the page; the cost / tokens charts fail on one basalt P1 (the `ViewTabs` indicator radius 3, off the scale). Fixed (confirmed, #155): the leading 30 d billing sentence ends with its step (`…; check it is running`); every other surface keeps the short form `No usage ingested`, no surface shows both. Carried (basalt): hue-only warn/bad days at 6 px band cells, the top-set empties in `ChartCard`'s placeholder, the tokens `fill` band, `$0` / `<$1` tooltip rows, `Sept` beside `Sep`, ragged strip footers. No lost fact.
- **Against Keel:** close — Keel leaves no band under a plot and never sets an empty message at the top.
