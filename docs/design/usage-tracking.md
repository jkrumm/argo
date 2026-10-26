# Usage Tracking v2 — spec

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

## Page structure

Top band (answers the three questions, one row at 1440; stacked at 390). Then a lens bar, then sections.

```
PageBar: Range · Grain · Workspace · Payer                         [IU cap · fresh 2 h]
Q1 IU cap            Q2 Subscriptions                      Q3 Biggest movers (7 d vs prior 7 d)
 gauge $573/$500      iu 20x  ▓▓▓▓▓▓▓░ 7 d 71 % · resets 2 d 4 h  ▲ review_ocr · deepseek-v4.1-flash  +$31
 over by $73          me 5x   ▓▓▓░░░░░ 7 d 34 % · resets 5 d 1 h  ▼ review:adversary · gpt-5.6-terra  −$12
 can spend today −$66  pace tick on each 7 d meter           ▲ worker · deepseek-v4.1-flash      +$9
 frees $63 / 7 d (bars)  reset in 2 d 4 h
─────────────────────────────────────────────────────────────────────────────────────────────
Lens: ( Spend $ | Tokens )   Payer scope: ( IU API | all API | + subscriptions )
A  Where it goes over time      stacked area by tool (sub_tool) + ranked BarList
B  Top spenders: tool · model    ranked list, $ and tokens side by side
C  Cache efficiency              per-tool four-way token split + cache-read share
D  Portal vs tracked             daily bars of portal vs tracked + delta strip
E  Projects                      BarList top 10 + other, with workspace tag
F  Routing (collapsed)           lane × account picks + coverage note
G  Reliability (collapsed)       error-day BandStrip, p95 sparkline by source
```

Cut from v1: call-count headline, the five-cell strip, payer split bar, 30 d quota line chart, picks-per-day bars.

### Q1 — IU cap gauge

- **Question**: am I inside the rolling 30-day $500 cap, and what can I spend today?
- **Kind**: `Meter` bar (value `rolling30`, max `limit`, tick at 80 %), state word and tone from the vocabulary. Under it `Bars` (axis-less, 7 bars) of the next 7 days' drop-off, each labeled with the day and `frees $`. Text lines: `can spend today`, `burn 7 d $/day → in 7 days $X`.
- **Contract** `GET /usage/iu-budget` → `{ limitUsd: 500, windowDays: 30, fetchedAt, windowFrom, windowTo, rolling30Usd, canSpendTodayUsd, burn7dUsdPerDay, projected7dUsd, daily: [{day, usd}], dropoffNext7: [{day, freesUsd, headroomUsd}], topModels: [{label, usd}] }`. Definitions are usage-tracker `budget.ts`: window = today and the 29 days before; `canSpendToday = limit − sum(the 29 days before today)`; drop-off day *d* frees that day's portal cost when it leaves the window.
- **States**: *fresh* normal; *stale* (> 8 h) value kept, `stale · fetched {age}` in warn ink; *dead* (> 48 h) value dimmed with `portal session expired — run make iu-portal-login in usage-tracker`; *empty* (no rows) `No portal data yet`; *over* error tone with `over by {$}`.

### Q2 — Subscription headroom

- **Question**: how much of each Max subscription's weekly window is used, am I on pace, when does it reset? The 5 h window is dropped: it saws up and down by design and answers nothing a decision hangs on (owner, 2026-10-26).
- **Kind**: one `Meter` per account (7 d). The meter has a **pace tick** at `elapsed / 7 d` of the window (derived from `sevenDayResetsAt`); fill past the tick = ahead of pace. Caption `resets in {d h}`. State words at 80 / 100 %.
- **Contract**: existing `GET /usage/quota` (latest point per account) + `GET /usage/account-picks/summary` for the routing ratio line `iu 19 % of picks`. Wave 2 adds nothing here; Wave 3 reads the last bucket only.
- **States**: no sample for an account → `no reading`; sample older than 30 min → `stale {age}`; `authOk=false` → `auth failed`.

### Q3 — Biggest movers

- **Question**: what changed most in dollars this week?
- **Kind**: three-line ranked text list with delta glyph + `DeltaBadge`, no chart. Rows are `(sub_tool, model_norm)` pairs, API payers only.
- **Contract** `GET /usage/movers?window=7d&limit=3&payer=iu-api,me-api` → `{ current:{from,to}, prior:{from,to}, rows:[{subTool, model, costUsd, priorCostUsd, deltaUsd}] }` sorted by `|deltaUsd|`. Pairs under $2 total in both windows are dropped.
- **States**: no pairs above the floor → `Spend is flat vs the prior 7 days`.

### Lens — Spend $ vs Tokens

One switch (`lens`, in the URL via `usageStore`) drives A, B, C-detail and E. **Spend** scope default `IU API`; `+ subscriptions` adds Max rows tagged *list value* (hatched/muted, never in the same stack total as spend). **Tokens** shows the four-way split with cache-read as its own series; the headline total is labeled `{x} B incl. cache-read` and is never added to "fresh tokens".

### A — Where it goes over time

- **Question**: which tool's spend/tokens moved, and when?
- **Kind**: stacked `CartesianChart` area (existing folded chart), `foldTopN` 6 + Other, adjacent `BarList` as legend. Group-by switch Tool / Model / Source / Payer. In tokens lens the group-by is replaced by the four token classes.
- **Contract**: `GET /usage/timeseries` extended (below) — `metric=cost|tokens_input|tokens_output|tokens_cache_read|tokens_cache_write`, folded server side: `top=6` returns the top-N keys by range total plus an `other` key, so the payload is ≤ 7 series (30 d × 7 ≈ 25 kB instead of 448 kB).
- **States**: empty range → `ChartCard state.empty`; a key with all-null cost (unpriced) is drawn at 0 and counted in the footer `n rows unpriced`.

### B — Top spenders: tool · model

- **Question**: for a given tool, which model is it burning money on, and is that the right model?
- **Kind**: one ranked `BarList` of `sub_tool · model` pairs (top 12 + Other), bar length = lens value, a muted second figure beside it (`$` in Tokens lens, tokens in Spend lens), and the cache-read share as a small tag. No Heatmap, no Sankey: the question is "what is the single most expensive thing", and a ranked list answers it (`review_ocr · deepseek-v4.1-flash` first). Click a row sets the `sub_tool` + `model` filters.
- **Contract** `GET /usage/flow?range&lens=cost|tokens&payer&top=12` → `{ total, rows:[{source, subTool, model, cost, input, output, cacheRead, cacheWrite, reasoning, calls}] }` already aggregated at `(source, sub_tool, model_norm)`; ≤ 200 rows. The client derives the heatmap, ranked lists and the cell drill-down from this single response (this is also C's contract).
- **States**: nothing in scope → empty; rows with `model_norm` NULL group as `(unknown model)` and are listed with their row count.

### C — Cache efficiency

- **Question**: which tools pay for fresh input that should have been cached, and which are cache-dominated?
- **Kind**: horizontal `Bars` per `sub_tool` (top 10), 100 % stacked: cache-read / cache-write / fresh input / output, label `cache-read {pct} %`; second column `$ per 1 M tokens`. Read from the `/usage/flow` response (aggregated to sub_tool client side).
- **Why**: `review:adversary` at 4 % cache on gpt-5.6-terra vs `review_ocr` at 94 % shows in one glance; the $ column says which one to fix.
- **States**: tools under 1 M tokens are folded into Other; sources that do not report cache fields (audio-gateway) show `no cache data`.

### D — Portal vs tracked (reconciliation)

- **Question**: can I trust tracked spend as the IU number, and where is the gap?
- **Kind**: `Bars` grouped per day (portal, tracked) for 30 d with a delta strip below (`BandStrip`: ok within max($1, 20 %), warn beyond, same rule as `make budget`). Click a day → per-model table `portal vs tracked`.
- **Contract** `GET /usage/iu-reconcile?days=30` → `{ days:[{day, portalUsd, trackedUsd, deltaUsd, ratio, flagged}], models:[{label, portalUsd, trackedUsd}], unpricedRows, windowTotals:{portalUsd, trackedUsd} }`. Tracked = `SUM(cost_usd) WHERE billing='iu'`; model join is by portal label ↔ `model_norm` prettified, unmatched go to `(unmatched)`. `unpricedRows` = IU rows with NULL cost.
- **States**: no portal data → whole section collapses to a one-line `connect the portal sync` note; the most recent portal day is partial and flagged `partial`.

### E — Projects

- **Question**: which project is the spend for?
- **Kind**: `BarList` top 10 normalized `project` + `Other`, workspace as muted tag; lens follows (spend or tokens); Max projects only appear under `+ subscriptions` as list value.
- **Contract**: existing `breakdown?dimension=project` with `payer` scope; `limit=10` and the `(unset)` bucket labelled `(no project)`.

### F — Routing (collapsed by default)

Lane × account picks `BarList` + the reason column (existing `picks-panel`), plus a coverage line `since 24 Oct · {n} picks`. Drop the picks-per-day bars. Empty < 20 picks → `Not enough picks yet`.

### G — Reliability (collapsed by default)

Existing error-day `BandStrip` and p95 sparkline, scoped per `source` selector, with `agent-gateway-sessions` excluded by default (a sessions feed, not call failures). No KPI cells.

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

## Pass criteria

1. The top band answers the three questions without scrolling at 1440 and 390; no number on it is a Max list value labeled "cost".
2. The Q1 figures equal `make budget` in usage-tracker for the same fetch (rolling30, can-spend-today, drop-off).
3. The lens switch changes A, B, E and keeps every total consistent with the band; cache-read is a visible series in Tokens.
4. B lists `review_ocr · deepseek-v4.1-flash` first in Spend and in Tokens, with its cache-read share.
5. D shows 2026-10-22 as flagged (portal $71 vs tracked $30).
6. The page loads from the new endpoints only; no response above 60 kB; slowest endpoint < 1 s warm.
7. No legend above 8 entries; no section whose question is not stated above; both schemes; `make check` green; `basalt-design-reviewer` pass.

## Token accounting (decided 2026-10-26)

How usage-tracker counts, verified in the collectors: every source is normalized to one **additive** contract — `input_tokens` is fresh uncached input only, `cache_read` and `cache_write` are separate, `output` includes nothing else, `reasoning` is its own column. Anthropic reports it that way natively; OpenAI-shaped sources (Codex, astra, audio-gateway, agent-gateway-iu) report cached tokens *inside* `prompt_tokens`/`input_tokens`, and the collectors subtract them back out. Cost is priced per row from those four classes, so **dollars are right**. Tracker side needs no change.

Rules for the page:

- **Three numbers, never one.** *Fresh* = input + output + cache-write + reasoning (what the model newly processed). *Cache-read* = tokens re-read from cache (billed ~10 % of input, but it is most of the volume). *Processed* = fresh + cache-read (what the "tokens flexed on social media" usually means — gross context handled, which inflates with every agent turn and is not comparable across tools). The headline is **fresh**, with `+ {x} B cache-read` beside it; "processed" appears only as a tooltip total.
- Output is the real work; cost per 1 M output and cache-read share per tool are the efficiency figures (section C).
- Cache-read is summed across calls on purpose: each call re-reads the prefix and is billed for it. The old `metricExpr('tokens')` comment ("cache-read is not a delta, summing double-counts") confuses unique tokens with billed tokens; the exclusion stays for the legacy `tokens` metric (Tinycast reads it) but the new metrics split all classes.
- Reasoning tokens are counted in cost; they are shown inside Output in the lens, not as a fifth series.
