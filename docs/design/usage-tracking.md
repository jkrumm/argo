# Usage Tracking — spec (v6)

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

## Page structure (v6, Wave 6 — supersedes v5's layout, keeps its mental model)

Owner verdict on v5 (2026-10-27): the wallet cards work; tokens must be as prominent as dollars; the When heatmap reads poorly (cut); show how each subscription's weekly volume built up over time; projects need a timeline (when did we work on what); IU API spend without a project is a gap to fix at the source; the Claude subscriptions do the same job, so compare them and show them combined instead of one tab each; IU API stays apart (different use). A third subscription (`me2`, Max 5x, payer `me2-sub`) is being onboarded and must slot in without a layout change.

### Families

- **Claude Max** = every Max subscription (`iu-sub` 20x, `me-sub` 5x, `me2-sub` 5x, any later one). Same work, compared and summed. Hues: IU Max gold, Me Max sky, Me2 Max turquoise.
- **IU API** = the metered lane (neutral greys), different use cases, its own tab. It has one wallet per IU API key (`personal`, payer `iu-api`; `athena-team`, payer `iu-team-api`, Athena Teamchat's shared key), each with its own rolling-30-day $500 cap. `Me API` stays a footnote card at ≥ $1.

A subscription with no usage and no quota sample in the range has no card and no series (me2 before its first login).

### Tabs and controls

`Overview · Claude Max · IU API`. Filters: Range, Measure (`$` / Tokens), Workspace; Grain where a chart reads it. Claude Max tab adds an Account segmented control (All + one per subscription) that scopes the whole tab; the IU API tab adds a Key segmented control (`All | Personal | Athena team`, `usageStore.iuKey`, same home and persistence) that scopes the whole tab.

### Overview

```
1 Wallet cards     one per subscription + one per IU API key, by container width (`walletSpans`, Grid of 60 columns): all in ONE row when each card stays at least 288 px (5 wallets from a 1504 px container, about a 1810 px viewport), then two rows that split their own row evenly (5 = 3 × ⅓ + 2 × ½), then three, then one per row. Inside: limit meter with pace,
                   then TWO equal figures side by side — $ (list value | spend, Δ) left, tokens (fresh Δ, cache-read under it) right,
                   daily sparkline (measure), "mostly <project> · <tool>"
2 Weekly volume    Claude Max: stacked weekly bars per subscription (measure), whole history   | Weekly quota: seven-day % per account
                                                                                                  over 30 d (the sawtooth of each window filling and resetting), 100 % line
3 Rhythm           weekday × hour, all wallets (measure)
4 Projects | Tools split rows (bar segmented by wallet) + an inline daily sparkline per row; a row opens its timeline:
                   daily bars stacked by wallet for that project over the range (timeseries project=<key>)
```

### Claude Max tab (combined, compare)

```
1 Compared         one row per subscription: plan · price / month · list value · value multiple (list value ÷ price prorated to the range)
                   · fresh tokens · cache-read · active days · weekly quota peak; summed row for All
2 Weekly quota     sawtooth per account (bigger), current week's pace for the selection
3 Volume per day   stacked by subscription | tool | model | project (measure)
4 Rhythm           weekday × hour (selection)
5 Projects | Tools | Models   ranked lists (selection)
```

### IU API tab

v5's wallet tab for the IU API, plus a coverage line: the share of spend with no project. Attribution fix: agent-gateway's `recordIuUsage` gains `job_id` + `cwd` (dispatch `iu-usage-project-attribution`), usage-tracker maps `cwd` → project; a history backfill follows if the job ledger allows a deterministic match.

**Key control** (2026-10-28): a segmented control `All | Personal | Athena team` in the `Section` tabs slot, built like the Claude Max Account control. It scopes the whole tab: the cap meter, can-spend-today, portal vs tracked, figures, over time, rhythm, the ranked lists, where the tokens go, cost per 1 M, the no-project line. Personal reads payer `iu-api`, Athena team payer `iu-team-api` (the payer already carries the key, so no `iuKey` filter is sent on the records endpoints).

**All = two meters, never a sum.** Each key has its own $500 cap in IU's portal, so under All the Limit row is two cards side by side titled by the key (`Limit · Personal`, `Limit · Athena team`; each its own meter and can-spend-today), and Portal vs tracked is two equal cards side by side, one per key; a summed cap would read as headroom neither key has. The records views (figures, charts, lists) add the two keys' spend, and a line under the meters says so. Selecting one key shows one full-width card.

**What a gap means is per key** (`gapReading` in the `IU_KEYS` registry). Personal, `pricing`: we price those rows ourselves, so portal above tracked is mostly a pricing or unpriced-row difference (Gap 4); the card reads exactly as before (amber flag, `−$41 · 0.42×`, signed totals line). Athena team, `unseen`: its tracked costs are producer-reported, so the gap is **spend by producers we do not see**, in neutral words and ink: "Portal $34 · tracked $10 · $24 from producers we do not see", differing days drawn in `VX.line` (not a status ink) and read `$41 unseen · 0.42×`. The team key's portal total ($33.85 on 2026-10-28) exceeds what is tracked (~$10.06) because its 2026-10-22..25 build-phase spend predates the teamchat DB rows. The per-day flag rule (max($1, 20 %) of the portal figure) is the same for both. Tracked above portal keeps a signed excess for either.

**Few rows.** The team key's portal models are few (Deepseek V4.1 Flash, Gemini 3.5 Flash, Sonar); every ranked list, the per-model list and the pair list render one to three rows as a short card, and none as the section's empty line. A row with no model (Athena teamchat mostly reports none; the API sends `(unknown model)` or `(unset)`) reads **Unknown model** in lists, pair labels and series legends (`modelLabel`), and a leading `provider/` (the team key reports `deepseek/deepseek-v4.1-flash`) is dropped. Rows that then read the same are one row: `mergeByLabel` sums their measures, prior windows and payer cells in the ranked lists, and `rankPairs` merges the (tool, model) pairs by label, so Key = All never lists a model twice.

**No portal report yet** (a key IU's portal has not reported for: `fetchedAt` null, or no portal days). One shared cause and next step on the wallet card, the Limit card and the Portal vs tracked card: "No portal report for this key yet · the next portal sync fills the cap" ("… fills this comparison" on the Portal vs tracked card), and on the cap a plain line "tracked so far $3 of $500 · 30 d" from the rolling-30-day split. A meter is never drawn from tracked spend (the portal is the cap's truth), and the Limit card's info says so instead of describing a meter and its tick. The Portal vs tracked card keeps its frame and title (`Portal vs tracked · Athena team spend · 30 d`) with that line inside, so keys side by side stay two equal cards. A synthetic empty state (a shot with the data withheld) keeps the section's original line, "Portal vs tracked · connect the portal sync".

Plan prices (list, per month, edit in `accounts.ts` when a plan changes): Max 20x $200, Max 5x $100. The value multiple is list value at API prices over that price — what the flat fee bought.

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
| Q1 | `No portal report for this key yet · the next portal sync fills the cap` | `stale · fetched {age}` > 8 h; dead > 48 h with the login command |
| Q2 | `no reading` per account | `stale {age}` > 30 min |
| Q3 | `Spend is flat vs the prior 7 days` | n/a |
| A–C, E | `ChartCard state.empty` | `last event {age} ago` footer; red dot > 30 min |
| D | one-line note | latest day marked `partial` |
| F | `Not enough picks yet` | coverage line |

## Controls × cards (audited 2026-10-28)

Each control was checked against the query arguments of every card (`lib/queries/usage.ts` and each component's call). Range = the Range filter, Measure = `$ / Tokens`, WS = Workspace.

| Card | Range | Measure | Grain | WS | Account / Key |
|-|-|-|-|-|-|
| Overview wallet card figures | applies | fixed: `$` and fresh tokens always | n/a | applies | n/a |
| Overview wallet card sparkline, "mostly" line | applies | applies | n/a (day) | applies | n/a |
| Wallet card meters (quota week, IU rolling cap) | fixed window, said in the card ("weekly quota · 7 d", "cap · rolling 30 d") | n/a | n/a | n/a (portal and quota have no workspace) | the card's own wallet |
| Weekly volume | fixed, all time (title says so) | applies | fixed week | applies | n/a |
| Weekly quota (30 d) | fixed, 30 d (title says so) | n/a | n/a | n/a | n/a |
| Rhythm | applies | applies | n/a | applies | Account / Key scope it |
| Projects / Tools rows, sparklines, timelines | applies | applies | fixed day | applies | n/a on Overview |
| Compared | applies | fixed: `$` and tokens columns | n/a | applies (days held ignore it on purpose) | Account scopes the rows |
| Claude Max: quota vs pace meters | fixed, this week (title says so) | n/a | n/a | n/a | Account scopes |
| Over time | applies | applies | applies (hour reads at most 30 d, said in the title) | applies | Account / Key scope it |
| Ranked lists, flow lists (top spenders, cost per 1 M) | applies | applies (cost per 1 M is `$` per million) | n/a | applies | Account / Key scope them |
| Figures strip (IU API) | applies | fixed | n/a | applies | Key scopes it |
| No-project line (IU API) | applies | fixed: dollars | n/a | applies | Key scopes it |
| Limit card (IU API) | fixed, rolling 30 d (title says so) | n/a | n/a | n/a (portal) | Key picks the card(s) |
| Portal vs tracked | fixed, 30 d of the whole key (title and info say so) | n/a | n/a | n/a: neither side is filtered, so no workspace-filtered tracked meets an unfiltered portal | Key picks the card(s) |
| Routing | own range control | n/a | n/a | n/a (the picker log has no workspace) | not filtered by Account on purpose |

The Grain control is shown only on the Claude Max and IU API tabs, where Over time reads it. Fixes from this audit: the wallet cards' meters name their fixed window; the Portal vs tracked info says the Range and Workspace filters do not apply.

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

## Build record (Wave 6, 2026-10-27)

Shipped to the v6 structure above, dashboard only (the API of `a670f121` was already live). `PageBar` tabs Overview / Claude Max / IU API (`usageStore.view`: `overview | claude | iu-api`); the retired `iu-sub` / `me-sub` values from an old URL or stored value fold into `claude` with that account selected (`migrateUsageSearch`, tests in `window-stores.test.ts`). The Claude Max tab's Account control is `usageStore.account` (`all` plus every id of the registry, shown in a `Section` tabs slot). `groupBy` gained `payer` (labelled Subscription, offered on the Claude Max tab only).

| Piece | Code | Data |
|-|-|-|
| Registry | `accounts.ts`: `USAGE_ACCOUNTS` (iu 20x, me 5x, me2 5x), `USAGE_PAYERS` (+ `me2-sub`, turquoise), `PLAN_PRICE_USD` (20x $200, 5x $100), `SUB_WALLETS` derived | every subscription list derives from it; a fourth is one registry entry |
| Live list | `wallet-model.ts` (`liveSubscriptions`, `liveWallets`) | split `totals` (usage in the range) plus the accounts named by `/usage/quota` (30 d); no usage and no sample = no card, no series, no Account option, no Compared row |
| Wallet cards | `wallet-cards.tsx` (`Figure`) | split `totals` and `prior`, day timeseries by payer, `mostlyOf`; $ left, tokens right, cache-read under the tokens |
| Weekly volume | `weekly-volume.tsx` | `timeseries range=all grain=week groupBy=payer payer[]=<subs>`; the running week is drawn lighter |
| Weekly quota | `weekly-quota.tsx`, `quota-model.ts` (`quotaRows`, `quotaPeaks`, `dayTicks`) | `/usage/quota?hours=720`, one line per account in its payer hue, 100 % reference line; the card states where the samples begin |
| Projects / Tools rows | `split-lists.tsx` | split `by=project|sub_tool`; one `timeseries groupBy=<dim> top=12` call feeds every row's sparkline; a project row opens `timeseries groupBy=payer project[]=<key>` as daily bars by wallet; one row open at a time, `UnstyledButton` with `aria-expanded` / `aria-controls` |
| Compared | `compared.tsx`, `value-model.ts` (`comparedRows`, `valueMultiple`, `proratedDays`) | split totals, day timeseries by payer (active days, first row), quota peaks; value multiple = list value ÷ (price × days / 30), `all` counts days from the subscription's first row; a summed row (pooled multiple, union of active days) |
| Claude Max tab | `claude-tab.tsx` | everything scoped by `payer[]` through `scope.ts` (`claudeScope`); `This week · quota vs pace` is one `SubscriptionMeter` per selected account |
| IU API tab | `iu-api-tab.tsx` | the v5 wallet tab for `iu-api` plus `ProjectCoverage` (the `(unset)` row of split `by=project` over the wallet's total, `unsetShare`) |

Deleted: `when.tsx` and the When pieces of `heat-model.ts`, `wallet-tab.tsx`, `wallet-limit.tsx` (the per-subscription week curve), `pace-model.ts` and its test, `WALLETS` / `walletOf` / `CardWallet`, `biggestWallet`.

Deviations from the spec text:

- The wallet card's two figures are a local `Figure` pair, not `ChartCard facts`: the card is ~300 px wide at four cards and `facts` stacks them. They read the lens-independent `cost` and `fresh`; the Measure filter drives the sparkline, the "mostly" shares, the rows and both charts.
- The biggest wallet's share left the Projects / Tools row header: at 390 px it crowded the name to an ellipsis, and the amounts under the bar already name every wallet.
- A Tools row's timeline is one neutral series, not stacked by wallet: `/usage/timeseries` has no `sub_tool` filter, so a per-wallet series for a tool would need one call per wallet. API gap, reported, not worked around.
- A project's `(unset)` row has no timeline (the `project` filter matches a column value, the row is NULL).
- "No usage and no quota sample in the range": the quota side is the 30 d history of `/usage/quota`, whatever the Range filter says. me2 (live 2026-10-27: a `quota-latest` sample, no usage rows) therefore shows a card with its 0 % meter and "No usage in this window", a Weekly quota line, an Account option and a Compared row of dashes.
- Quota peak is the highest reading in the range among the collector's samples (since 2026-10-24); "—" without samples.
- Weekly quota draws the samples that exist, not an empty 30 d axis, and says so ("Samples since 24 Oct").

Shots: `make design-shot` rounds `usage-v6-r1` .. `r3` on live data, `/usage-tracking`, `?view=claude`, `?view=iu-api`, light + dark, 1440 + 390. Not run: the `basalt-design-reviewer` subagent and `basalt-ui shot detect`. Not verified on real data: me2 with usage (unit tests cover the live list, the value multiple and the pooled row with a no-usage subscription).

- Orchestrator fix after r3: the value multiple prorates each subscription over the days it was held in the range (first row ever, from an all-time day series), not the whole range; Me Max (held since 24 Oct) read 16× over 30 d, the held-days figure is several times that.

## Routing (Wave 7, 2026-10-27)

A **Routing** section at the bottom of the Claude Max tab, built for tuning the Claude account picker (dotfiles `docs/claude-accounts.md`, rule v1.4: ceilings session 90 / weekly 95, weekly 98 while a window resets within 24 h) from its own log over weeks. Dashboard only; the endpoints were already live. Its range control (1d, 3d, 7d, 14d, 21d, default 7d) is `usageStore.routingRange`, independent of the page Range, and the tab's Account switch does not filter it: routing is about choosing between accounts. Every block reads from where the data begins (picker log and quota samples since 2026-10-24) and says so.

| Block | Question it answers | Code | Data |
|-|-|-|-|
| Facts strip | How often does it spill, what does it leave unused, how long does a refilled window sit idle? | `routing.tsx`, `routing-model.ts` (`spillFacts`, `windowFacts`) | summary `lanes`, `/usage/routing/windows` (5 h windows of all accounts pooled) |
| Who served each lane | Which account took which lane when, and what did the picker see? | `routing-picks.tsx` (`laneRows`, `cellState`, `snapshotText`) | `/usage/account-picks` |
| Why accounts were chosen | Is home still the norm, or are the ceilings binding (spill, no eligible account)? | `routing-charts.tsx` (`ReasonMix`; `reasonKeys`, `reasonColor`) | summary `groupBy=reason` |
| Spill rate per lane | Which lane spills? | `routing-charts.tsx` (`SpillByLane`) | summary `lanes` |
| 5 h session quota | How close do accounts run to the session ceiling, when do windows refill? | `routing-charts.tsx` (`Sawtooth`; `fiveHourRows`, `resetTicks`), `PICKER_CEILINGS` in `accounts.ts` | `/usage/quota?hours=<range>` (`series`, `resets`) |
| Tuning | Per account: capacity expired at a 5 h reset, wait until picked again, resets never picked after, capacity expired at the last 7 d reset | `routing.tsx` (`tuningRows`) | `/usage/routing/windows` `summary` + `windows` |

Forms: the timeline is one `BandStrip` per lane (busiest first, at most 8; a state per slot with legend and tooltip derived from `states`; a scatter would need a lane axis basalt has no form for), the strips share one cursor, and `fold` merges cells at narrow widths. The sawtooth is `CartesianChart` with `marks` (lines, `ruleX` resets, a `text` label per 7 d reset) because `Lines` has no vertical rule with a label. New series group `ROUTING_REASON` (`home`, `pace`, `session` accent shades, `other` grey); an account is always its payer shade.

Deviations from the brief:

- A pick no account could serve (`picked` = `spill`, or reason `no-eligible-account`) is `VX.status.bad` in the timeline, not warn, so it matches the reason mix, where spill (`warn`) and no-eligible-account have to be told apart. A pick an account only took as overflow (reason `spill`, `picked` an account) keeps that account's shade with a warn marker over the cell; it is what the spill rate counts.
- The session ceiling line is neutral, not a status ink: status inks are spent on spill and no-eligible-account only.
- The weekly ceiling (`PICKER_CEILINGS.weekly`) is recorded but not drawn: no chart shows the weekly percent per account at the picker's resolution.
- The facts strip pools the 5 h windows of every account (median of windows, not of per-account medians).

Not verified on live data: the 7 d reset label (no weekly reset has been sampled yet; checked once with a temporary stand-in, then removed), the hover tooltip content (static shots), a populated 14d / 21d range (the log is three days old), unknown reasons or accounts (the model tests cover them).

## IU API keys (2026-10-28)

Dashboard only; the API with `iu-team-api`, the `iuKey` parameters on `/usage/iu-budget` and `/usage/iu-reconcile` and the `iu_key` dimension was already in the tree.

| Piece | Code | Data |
|-|-|-|
| Key registry | `accounts.ts`: `IU_KEYS` (id, label, payer, wallet title and who-line), `IU_KEY_WALLETS` (the team wallet comes from here), `IU_API` (looked up by payer id), `isKeyWallet`; `USAGE_PAYERS` + `iu-team-api` ("Athena team") | a later key is one `IU_KEYS` entry plus one payer entry; a `KeyWallet` is told from `ApiWallet` (Me API) by its `iuKey` |
| Key control | `window-stores.ts` (`iuKey`: `all` + registry ids, URL + persisted like `account`), `iu-api-tab.tsx` (`Section` tabs slot) | none |
| Scope | `scope.ts` (`iuKeyScope`: one payer, or both for All; `selectedKeyWallets`) | `payer[]` on split / timeseries / rhythm / flow |
| Caps | `limits.tsx` (`WalletMeter` mounts `SubscriptionWalletMeter` or `KeyCapMeter`; `useKeyBudget` reads `usageQueries.iuBudget(key)`), one `KeyLimit` card per selected key | `/usage/iu-budget?iuKey=` |
| Team wallet card | `wallet-model.ts` (`liveWallets` lists every key's wallet, `cardsPerRow`), `wallet-cards.tsx` (Open selects the key) | split totals + `/usage/iu-budget?iuKey=athena-team` |
| Portal vs tracked | `reconciliation.tsx` per key wallet (title, anchor from the registry), `reconcile-model.ts` (`GAP_PRESENTATION`: info, strip states, band function per `GapReading`; `gapLine`, `dayReading`) | `/usage/iu-reconcile?iuKey=` |
| Figures / lists | `wallet-figures.tsx` and `use-flow.ts` take the scope's payers; `split-model.ts` `combinedTotal` sums the keys for All, `mergeByLabel` folds rows with the same label | split totals, flow |

Colours: a five-step grey ramp holds only three greys two steps apart, and four payers share it. Athena team takes light step 2 (`#a1a1aa`, the strongest legible step two from IU API's 0) and dark step 4; Me API (~$0, a card only from $1) moves from light step 1 to 4 (dark unchanged at 1), which keeps it two steps from Athena team; `unknown` moves from light step 2 to 3 so no two payers share a shade. The faint Me API / unknown light greys are the price: both are rare. IU API keeps its shade, its card and its numbers.

Decisions and deviations:

- A cap or reconcile response carries the key it computed in `iuKey`. `answersKey` refuses another key's answer (shown as no portal report, never as this key's headroom); a response without the echo (an API from before keys) counts as the personal key's. Callers always name their key (`usageQueries.iuBudget(key)`), and `WalletMeter` fires the budget query only for key wallets.
- The Overview shows the team wallet card always, like the personal one: its cap is worth seeing at $0. Five cards fill two rows as 3 + 2 instead of 4 + 1 (it also fixes the existing Me API orphan); the personal card's content is unchanged.
- Group by on the IU tab stays Tool / Model / Project; a "by key" grouping under All is not offered (the store's `groupBy` `payer` value is labelled Subscription and belongs to the Claude Max tab).
- The Wallet card's title stays "IU API"; the IU API tab's cards use the key label.

Shots: `make design-shot` rounds `iu-keys-r1` .. `r4` and basalt shot rounds `iu-keys-r5` .. `r7` on production data, `/usage-tracking` with `?view=iu-api`, `&iuKey=personal` and `&iuKey=athena-team`, light + dark, 1440 + 390. The team key had records but no portal report during the rounds, so its no-portal state is what the shots show; its 1–3-row layouts are covered by model tests.
