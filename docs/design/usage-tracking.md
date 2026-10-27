# Usage Tracking — spec (v5)

Route `/usage-tracking` · `apps/dashboard/src/routes/usage-tracking.tsx`, `apps/dashboard/src/features/usage-tracking/` · API `/usage/*`.
Replaces the Wave 21–51 concept (history: git log of this file). Plan: `docs/waves/PLAN.md` (Waves 2–3 build this).

## Audit of the current page (2026-10-26, live data, light + dark)

Shots: `make design-shot ROUTES=/usage-tracking LABEL=usage-v2-audit` (gitignored). Endpoint timings against production, cold: `headline` 2.2 s, `timeseries` 0.5–0.8 s (the unfolded tokens-by-tool series is 448 kB), `breakdown` 0.3 s, `quota` 0.1 s.

| Section | Answers | Fails to answer / defect |
|-|-|-|
| Headline `347,552 calls` | nothing a decision hangs on | call count is the page title; the three real questions are absent |
| Strip: Cost `$19,136` | "how big is list-price consumption" | **Misleading.** 91 % is `IU Max` ($17,451) and 6 % `Me Max` — subscription usage priced at API list. Real API spend is $627 (3 %). The biggest number on the page is not money anyone pays |
| Strip: Tokens `2.4 B` | volume ex cache-read | The metric drops `cache_read_tokens` (`metricExpr('tokens')`). 30 d actual: 47.8 B cache-read vs 0.75 B fresh input vs 0.38 B output. IU API alone: 8.3 B cache-read. The cost driver is invisible |
| Strip: Errors / p95 / Cache hit | health | Nobody acts on p95 across 14 sources; cache hit 98.8 % is a fleet average that hides which tool is at 40 % |
| Payer split bar | mix | Same bar as `Spend by payer`; duplicate |
| Cost per day by payer + list | when, which payer | Dominated by Max list price; IU API is a sliver (the one line that is real money) |
| Claude quota (30 d) | headroom | 30 d axis, but samples exist only since 2026-10-24 (343 rows) → chart is a spike in the last 2 days. No pace, no reset time |
| Picks by lane / Picks per day | routing | picks since 2026-10-24 only (89 rows); three bars. Useful as a ratio, not as a 30 d chart |
| Tokens per day by tool + list | tools | Series are `sub_tool` only; no model, no payer lens, no cache split, `Interactive`/`Wave` (Max) outrank the IU review lanes that cost money |
| Latency and errors | health | 61 % of errors are `agent-gateway-sessions` (a sessions source, not a failing call). p95 of 27–44 s is an average of unrelated workloads |
| Top projects | where | Ranked by list-price cost, so `basalt-ui $2,651` is a Max number. Raw `project` has 6,376 distinct values in 30 d (cwd paths) before Argo's `normalizeProject` |

Verdict: the page answers "how much did I consume at list price" and not one of the three questions. Keep: filters, `BarList` ranked lists, the payer vocabulary, error-day `BandStrip` (moves into a drill-down). Cut: call-count headline, p95 and cache-hit cells as top-level KPIs, the payer split bar, the 30 d quota line chart, the picks-per-day bars.

## What the data already answers

Source: usage-tracker `usage.db` (769 k rows since 2026-04-14) mirrored in Argo `argo.usage_record`. 30 d window, billing=iu = $589 tracked vs portal $573.

- **Dimensions present**: `source`, `sub_tool`, `model_norm`, `project`, `workspace`, `account`, `machine`, `billing`, derived `payer`. Token columns: `input`, `output`, `cache_read`, `cache_write` (+ `cache_write_1h`), `reasoning`. All usable per day.
- **Where IU API money goes (30 d)**: `review_ocr` on deepseek-v4.1-flash $197 (3.5 B cache-read, 0.21 B fresh input, 0.12 B output); `review:adversary` gpt-5.6-terra $86 (25 M input, almost no cache — price per fresh token is the story); `review:angle` haiku-5.5 $48 (0.9 B read + 0.2 B write); research-gateway `worker` $48; claude-code `agent-gateway:check` $33; opencode interactive/review/dispatch ~$15 each. By source: agent-gateway-iu $300 of $589.
- **Cache-read, not input, is the volume**: for IU API 8.3 B cache-read vs 0.56 B input vs 0.19 B output. A flash model with 3.5 B reads out-spends an expensive model with 25 M fresh input — the tokens lens must show the four-way split, and "cache-read $" per tool is the efficiency number.
- **Max is sunk**: `billing=max` rows carry list-price `cost_usd` ($18.7 k). That is a *value* number (what the subscription saved), never a spend number.

### Gaps (Wave 2 closes the first three)

1. **Portal tables are not in Argo.** `iu_portal_cost` (235 rows, 2026-09-26 → 2026-10-26) and `iu_portal_total` (months) exist only in usage-tracker's SQLite. No cap, can-spend-today or drop-off is computable in Argo.
2. **No aggregate for the split.** `breakdown` returns one metric per key; the page needs cost + the four token columns + calls per key in one response. The tokens `timeseries` returns the full unfolded series (448 kB).
3. **No tool → sub-tool → model flow, no movers.** Needs a hierarchical aggregate.
4. **Tracked vs portal drift is real.** Daily ratio ranges 0.42×–2.72×; 2026-10-22 portal $71.44 vs tracked $30.21 (portal shows Claude Opus 5.5 $33 that tracking prices at far less), 1,631 IU rows (30 d) have `cost_usd` NULL (unpriced model, mostly `model_norm` NULL, 736 rows). The reconciliation strip exists to make this visible, not to fix it.
5. **Quota/pick history is 3 days old** (since 2026-10-24); charts must state the coverage, not draw a 30 d axis.
6. **`project` is high-cardinality** (6,376 raw in 30 d). Rank by normalized project and fold the tail into "other"; never a chart series.
7. Fields never read: `cost_source` (reported 47 k / computed 187 k / family 113 k / none 2 k) — surfaces cost *confidence*; show it in the reconciliation drill-down, not as a section.

## Vocabulary (shared with Tinycast `extension/src/usage/iu-budget.ts`)

- State words: **ok** (< 80 % of cap), **warn** (≥ 80 %), **over** (> 100 %). Weekly quota uses the same words at 80 / 100. Only the weekly window is shown anywhere on the page.
- Freshness: **fresh** ≤ 8 h, **stale** > 8 h, **dead** > 48 h since the portal fetch (`fetched_at`).
- Lines: `{$} / $500 ({pct} %)`, `can spend today {$}` (negative reads `over by {$}`), `frees {$} over 7 days`.
- Money is whole dollars, thousands separator, `<$1` below one. Tokens are `B` / `M`. Subscription cost is always labeled **list value**, never "cost" or "spend".
- Payers: `IU Max` / `Me Max` (subscriptions, list value), `IU API` / `Me API` (spend).

## Page structure (v5, Wave 5 — supersedes v3)

Owner verdict on v3/v4 (2026-10-27): still IU-API-heavy; the two subscriptions' theoretical spend and token volume are not visible as wallets of their own. He wants all three side by side, when each was used, which projects and tools each went to, a combined view and an expert view, one glance first.

### Mental model: three wallets, one currency

| Wallet | Who pays | Limit | `$` means |
|-|-|-|-|
| **IU Max** 20x | IU, flat | weekly quota % (pace tick, reset) | list value: what the usage would cost at API prices, ≈ quota burn |
| **Me Max** 5x | me, flat | weekly quota % | list value |
| **IU API** | IU, metered | rolling 30 d, $500 cap | spend: real money |

`$` at API prices is the one currency across all three (list value for the subs, spend for the API); it is never summed into a "cost". Tokens are the second measure: **fresh** (input + output + cache-write + reasoning) with **cache-read** beside it. `Me API` (OpenRouter, ~$0) gets no wallet; it appears only when its range total reaches $1.

### Controls

`PageBar` tabs = the view: **Overview · IU Max · Me Max · IU API**. Filters: Range (7d/30d/90d/All), Measure (`$` / Tokens), Workspace; Grain only where a chart reads it. The v3 "Payer scope" filter is gone: the tabs are the scope.

### Overview (combined, one glance)

```
1 Wallets   [IU Max 20x ] [Me Max 5x ] [IU API     ]   one card each, click opens its tab
            meter: 7 d quota + pace | 7 d quota + pace | 30 d cap + 80 % tick
            $17,260 list ▲ | $1,515 list new | $662 spend ▲      (delta vs prior window)
            1.1 B fresh · 36 B cache-read                        (tokens)
            ▂▃▅▇▆▃ daily sparkline (measure)                    (when, magnitude)
            mostly shutterflow 17 % · interactive 38 %           (where, top project + tool)
2 When      Heatmap rows = wallets, cols = hours (7d) or days (30d+); each row scaled to its own peak
3 Projects | Tools   split lists: one stacked bar per row, segment per wallet (payer hue), total + delta
```

Why: the wallets differ by 25× in `$` (IU Max list value vs IU API spend), so any shared axis buries IU API. Each wallet card owns its scale; the When heatmap normalizes per row (the tooltip carries the real figure); the split lists show the mix inside one project, with the wallet's share written out.

### Wallet tab (expert, one wallet)

```
1 Limit      the meter at full width; Max: this week's quota % line against the pace diagonal (from /usage/quota);
             IU API: cap meter + can-spend-today + portal vs tracked day strip
2 Figures    StatGroup: $ (list value | spend) Δ · fresh tokens Δ · cache-read · output
3 Over time  StackedArea by tool | model | project (group-by tabs), measure-driven
4 Rhythm     Heatmap weekday × hour of day (browser time zone), measure-driven
5 Projects | Tools | Models   ranked BarLists from /usage/split?payer=<wallet>, delta glyph, Other as a text line
6 IU API only: tool · model and cost per 1 M / cache-read % (the v3 IU detail, shown open)
```

### Data

| Block | Endpoint |
|-|-|
| Wallet figures, deltas, mostly-line, split lists, wallet-tab figures and lists | `GET /usage/split?by=project|sub_tool|model_norm&range&lens&payer[]` (`totals` per payer = headline; rolling windows, prior = equally long window before) |
| Sparklines, Over time | `GET /usage/timeseries` (day; `groupBy=payer` or tool/model/project with `payer=`) |
| When | `GET /usage/timeseries?grain=hour&range=7d&groupBy=payer` (hour for 7d, day otherwise) |
| Rhythm | `GET /usage/rhythm?payer=&metric=&tz=` |
| Limits | `/usage/quota-latest`, `/usage/iu-budget`, `/usage/quota` (weekly curve), `/usage/iu-reconcile` |

## Data work (build spec)

### usage-tracker → Argo portal sync

- **Argo tables** (migration 0026, `argo` schema): `iu_portal_cost(day date, label text, row int, model text null, cost_usd double, fetched_at timestamptz, PK(day,label,row))`, `iu_portal_total(month text PK, total_usd double, fetched_at timestamptz)`. `limit_usd` 500 and `window_days` 30 are constants in the API (`IU_CAP_USD`, `IU_WINDOW_DAYS`), because the portal tables do not carry them.
- **Endpoint** `POST /usage/iu-portal` (BearerAuth, same as `/usage/records`): body `{ costs: [{day, label, row, model, costUsd, fetchedAt}] (≤ 1000), totals: [{month, totalUsd, fetchedAt}] (≤ 24) }`. Upsert: `ON CONFLICT (day,label,row) DO UPDATE SET cost_usd, model, fetched_at` — the portal re-posts a day's value as it settles, so overwrite is correct and a replay is a no-op. Returns `{ costs: n, totals: n }`. Invalid rows are dropped and counted in `rejected`, never failing the batch (the `/usage/quota-samples` contract).
- **usage-tracker** (`src/sync-portal.ts`, same `argoConfig` / `postJson` with `tolerateMissing`): after each portal collect and in the 15 min sync, push every row whose `fetched_at` is newer than the stored watermark (`collector_state` key `argo_portal_fetched_at`), advance the watermark only on `ok`. First run sends all 235 rows. The 30-day window shifts daily, so also resend the last 35 days of `iu_portal_cost` every run when `fetched_at` moved (≤ 235 rows).
- **Idempotency**: PK upsert + watermark; a crash between POST and watermark write replays the same rows.

### Aggregate endpoints (Argo)

| Endpoint | Purpose | Notes |
|-|-|-|
| `GET /usage/iu-budget` | Q1 | from `iu_portal_cost`; pure functions ported from usage-tracker `budget.ts` with tests; ≤ 10 ms |
| `GET /usage/movers` | Q3 | two windowed `GROUP BY sub_tool, model_norm` sums; both windows in one SQL |
| `GET /usage/flow` | B, C | one `GROUP BY source, sub_tool, model_norm` with `SUM` of cost and the five token columns + `COUNT`; payer scope + range filters as `breakdown` |
| `GET /usage/iu-reconcile` | D | `iu_portal_cost` per day vs `usage_record` billing=iu per day, UTC-day buckets (portal days are UTC) |
| `GET /usage/timeseries` (extend) | A | `metric` gains `tokens_input|output|cache_read|cache_write`; new `top=N` folds server side into `N + other`; the existing `tokens` metric stays (without cache-read) so Tinycast and old callers keep working |
| `GET /usage/headline` | — | not read by the new page; Tinycast does not call it (it reads `/usage/timeseries?metric=cost&groupBy=sub_tool` and `/usage/summary`, which must keep their shape) — remove `headline` after the page ships |

Every endpoint takes `range`, `payer[]`, `workspace[]` like the existing ones and returns a decided empty shape, never 404. Page never pulls `/usage/records`.

## Empty / stale summary

| Surface | Empty | Stale |
|-|-|-|
| Q1 | `No portal data yet` | `stale · fetched {age}` > 8 h; dead > 48 h with the login command |
| Q2 | `no reading` per account | `stale {age}` > 30 min |
| Q3 | `Spend is flat vs the prior 7 days` | n/a |
| A–C, E | `ChartCard state.empty` | `last event {age} ago` footer; red dot > 30 min |
| D | one-line note | latest day marked `partial` |
| F | `Not enough picks yet` | coverage line |

## Pass criteria (v3)

1. Limits answer "where am I" in one row without scrolling at 1440 and 390; the IU cap equals `make budget` in usage-tracker for the same fetch.
2. Headline totals and the Projects / Tools rows come from the same buckets; Max dollars are always labelled list value, never spend.
3. The lens switches the chart and both lists; the headline always shows both measures.
4. Every row delta compares against the equally long prior period; no delta renders without a prior.
5. At most five visible blocks, legend of at most 8 entries, both schemes, `make check` green.
6. Page-level `basalt-design-reviewer` verdict is judged by the owner brief (concise, self-explanatory, build volume first), not the score.

## Token accounting (decided 2026-10-26)

How usage-tracker counts, verified in the collectors: every source is normalized to one **additive** contract — `input_tokens` is fresh uncached input only, `cache_read` and `cache_write` are separate, `output` includes nothing else, `reasoning` is its own column. Anthropic reports it that way natively; OpenAI-shaped sources (Codex, astra, audio-gateway, agent-gateway-iu) report cached tokens *inside* `prompt_tokens`/`input_tokens`, and the collectors subtract them back out. Cost is priced per row from those four classes, so **dollars are right**. Tracker side needs no change.

Rules for the page:

- **Three numbers, never one.** *Fresh* = input + output + cache-write + reasoning (what the model newly processed). *Cache-read* = tokens re-read from cache (billed ~10 % of input, but it is most of the volume). *Processed* = fresh + cache-read (what the "tokens flexed on social media" usually means — gross context handled, which inflates with every agent turn and is not comparable across tools). The headline is **fresh**, with `+ {x} B cache-read` beside it; "processed" appears only as a tooltip total.
- Output is the real work; cost per 1 M output and cache-read share per tool are the efficiency figures (section C).
- Cache-read is summed across calls on purpose: each call re-reads the prefix and is billed for it. The old `metricExpr('tokens')` comment ("cache-read is not a delta, summing double-counts") confuses unique tokens with billed tokens; the exclusion stays for the legacy `tokens` metric (Tinycast reads it) but the new metrics split all classes.
- Reasoning tokens are counted in cost; they are shown inside Output in the lens, not as a fifth series.

## Build record (Wave 4, 2026-10-26)

Before/after shots (v1 at `63487b7a` from a throwaway worktree, v2 at `e37fd986`, light + dark, desktop + 390) drove the keep/cut table below. v2's build record and shot rounds r1–r6 are in git history of this file.

| Piece | Verdict | Why |
|-|-|-|
| v1 cost-per-day chart, tokens-per-day chart | merged into Over time (lens picks the metric) | the owner wants $ and tokens across everything; one chart with the lens, grouped by payer / tool / model / source |
| v1 headline cost + tokens with delta vs prior 30 d | kept as Headline, now range-aware | v1's strength; deltas come from the same buckets as the totals |
| v1 top projects | kept, promoted beside Tools | projects worked on most is the first question |
| v1 tokens-by-tool list | kept as Tools | with $ and tokens per row |
| v1 errors / p95 / cache-hit cells, payer split bar, quota line, picks bars, latency chart | not restored | not the owner's questions; reliability can return as one collapsed line if it is missed |
| v2 cap gauge + subscription meters | merged into Limits (three meters, one row) | one glance at "where are the limits"; drop-off bars and burn text cut |
| v2 Movers | cut | per-row delta glyphs say what moved where it is ranked |
| v2 top spenders (tool · model) | kept, compact, in IU detail | where the API tokens go |
| v2 cache efficiency | list only (cost per 1 M, cache-read %), in IU detail | the four-way bars were the heaviest visual for the smallest question |
| v2 reconciliation | day strip + one totals line, in IU detail | per-model table and per-day bars cut |
| v2 token-class stack, Routing, Reliability, server list "Spend by tool" | cut | duplicated the lists or answered a question nobody asked |

Decisions: default scope is **all payers**; the Max share is labelled list value in the headline caption, its footer and the chart / list titles. Deltas compare the last N complete days with the N before (the running day is left out of both); a key the API folded away has no prior and shows no glyph; `new` marks a prior of nothing or a tenfold rise. The Other row of the ranked lists is a text line, not a bar, so it cannot squash the named rows. Fresh tokens leave cache-read out and say so.

Shot rounds (`basalt-ui shot /usage-tracking --base <evidence-server origin>`, live data): r1 own review (structure right, deltas of 3000 % and "0" token rows, fixed with the `new` rule and null figures); r2 reviewer 0 (page pass; the volume blocks had no anchors, headline $ unqualified, no definition of `new`); r3 reviewer 51 (page pass, 5 of 7 components pass). Fixed after r3 without a fourth shot: Other as a text line, `new` defined in the card info, tokens unit reads `B tokens`, empty-state grammar, anchors for Over time and both lists. Residuals: IU Max / IU API and Me Max / Me API payer hues are close (palette, not layout; group by Tool separates them); Limits empty copy is still `no reading`; loading and error states are route-level, not shot-declared; the tokens delta is neutral while the spend delta is red by design; the 390 px headline caption wraps.

## Build record (Wave 5, 2026-10-27)

Shipped to the v5 structure above, dashboard only (the API of `54a4e842` was already live): `PageBar` tabs Overview / IU Max / Me Max / IU API (`usageStore.view`), Measure (`$` / Tokens, `usageStore.lens` values `cost` | `tokens`), Range, Workspace, Grain (wallet tabs only; `hour` added, the API reads it at most 30 d). `scope` is gone: an old URL or stored value with it is dropped by the store (test in `window-stores.test.ts`); `groupBy` is tool / model / project.

| Piece | Code | Data |
|-|-|-|
| Wallet cards | `wallet-cards.tsx`, meters from `limits.tsx` (`WalletMeter`) | split `totals` (deltas from `prior`), day timeseries by payer (sparkline), `mostlyOf` over the split rows |
| When | `when.tsx`, `heat-model.ts` (`whenCells`) | timeseries by payer, hour grain for 7 d else day; each row scaled to its own peak, real figure in the tooltip |
| Projects / Tools | `split-lists.tsx`, `split-model.ts` (`mixSegments`, `cutList`) | split `by=project|sub_tool`, `top=50`, first 8 rows shown, tail one text line |
| Wallet limit | `wallet-limit.tsx`, `pace-model.ts` (`weekCurve`) | `/usage/quota-latest` (reset instant) + `/usage/quota?hours=168`; the window is reset − 7 d … reset |
| Figures, lists, rhythm | `wallet-figures.tsx`, `ranked-list.tsx`, `rhythm.tsx` | split `payer[]=<wallet>`, `/usage/rhythm` in the browser zone |
| IU API extras | `top-spenders.tsx`, `cache-efficiency.tsx`, `reconciliation.tsx` open under the cap meter | `/usage/flow` pinned to `iu-api`, `/usage/iu-reconcile` |

Deleted: `headline.tsx`, `iu-detail.tsx` (the collapse wrapper), the period-sum / rank pieces of `period-model.ts` (only `change` stays), `scopePayers`, `flowLensOf`, `SPEND_NOUN`, the old three-meter `Limits` card.

Deviations from the spec text:

- The wallet card's `$` and token figures always read `cost` and `fresh`; the Measure filter drives the sparkline, the When heatmap, the "mostly" shares and both lists.
- The "biggest wallet's share" of a split row sits in the row's header line (before the total), not on a line of its own: `Meter` already prints a caption per segment (amount + swatch) under each bar, so its own reading is turned off (`reading={false}`).
- IU API moved from orange to violet (orchestrator, after r1): in one split bar orange read as a second gold beside IU Max. No separate wallet legend: the segment captions name the wallets.
- Tooltips of the When heatmap name the wallet and the real figure; the cell shade is "% of the wallet's own peak" and is not comparable across rows.
- Me API gets a card only at ≥ $1 (no tab, no meter); with one it wraps to a second row of the card grid.
- Deltas now come from the API's rolling windows (`prior`), not from complete days; the running day is included on both sides.
- The week curve draws the samples the collector has (since 2026-10-24); a week that began earlier says so under the chart.

Shots: `make design-shot` rounds on live data (overview 30 d / 7 d tokens, the three wallet tabs, `shot-state=empty`), light + dark, 1440 + 390. Not run: the `basalt-design-reviewer` subagent and `basalt-ui shot detect`.
