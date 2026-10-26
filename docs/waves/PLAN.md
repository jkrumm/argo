# Usage, rebuilt — one page that tells the truth about the two subscriptions and the IU API
**Goal:** Argo's `/usage-tracking` answers three questions at a glance, then lets Johannes drill in: (1) am I
inside the IU API's rolling 30-day $500 cap, and what can I spend today; (2) how much headroom do the two Claude
Max subscriptions (`iu` 20x, `me` 5x) have this week, and are the pickers routing well; (3) where do
dollars **and tokens** actually go: which tool, sub-tool, model and project, with cache vs fresh input vs output
split, and how that moves over time. Tinycast stays the glanceable face and the page is the analysis face.
They use the same vocabulary and numbers.
**Gate:** `make check` green; each UI wave proves itself with the repo's evidence/screenshot command against
real data (light + dark), plus a basalt design review (`basalt-design-reviewer`). Deploy is the orchestrator's call.
Previous plan (basalt-ui 2.0 migration, Waves 1–10) is done; see git history of this file.

## Established — do not re-derive (orchestrator, 2026-10-26)

- **The IU cap's truth is IU's portal, not our estimate.** usage-tracker scrapes the self-service cost portal
  every 4 h (headless Chrome on the MacBook). It stores `iu_portal_cost(day,label,row,model,cost_usd)` and
  `iu_portal_total` in its SQLite (`~/.local/share/usage-tracker/usage.db` on the mini), and writes
  `~/.local/share/iu-portal/latest.json` on the MacBook for Tinycast (schema 1: `rolling30_usd`,
  `can_spend_today_usd`, `daily[]`, `top_models[]`, `dropoff_next7[]`, `limit_usd` 500, `window_days` 30).
  **None of this reaches Argo yet.** usage-tracker's `make budget` is the reference output: rolling-30 vs cap,
  can-spend-today, drop-off of the next 7 days, a 7-day burn projection, and portal-vs-tracked per day and per model.
  On 2026-10-26 the window stood at $573 / $500.
- **Where the IU money goes (usage-tracker, 30 d, billing=iu):** agent-gateway's review dominates.
  `review_ocr` (alibaba open-code-review CLI on deepseek-v4.1-flash, 3.5 B cache-read tokens) $197,
  `review:adversary` on gpt-5.6-terra $86, `review:angle` on haiku-5.5-eu $48, then research-gateway worker
  $48, the claude-code `agent-gateway:check` lane $33, opencode interactive/review/dispatch ~$15 each, and the
  audio-gateway podcast writer $28. This is exactly the analysis the page must make obvious without SQL.
- Tokens matter as much as dollars. Cache-read volume (billions) vs fresh input vs output explains cost: a
  cheap model with huge cache reads can out-spend an expensive one.
- Existing page: `apps/dashboard/src/routes/usage-tracking.tsx` + `apps/dashboard/src/features/usage-tracking/*`
  (~1.5k lines: cost/tokens/quota/folded charts, claude-accounts, picks-panel, top-projects, usage-strip,
  health-card, page-headline). Design doc `docs/design/usage-tracking.md`. API: `/usage/*` (records with
  `account`, `payer` = `iu-sub|me-sub|iu-api|me-api|unknown`, quota-samples, account-picks). basalt-ui 2.27,
  TanStack Charts. The basalt rules/skills are the authority (`.claude/rules/basalt-*.md`,
  `basalt-design` / `basalt-charts` / `basalt-app` skills).
- Tinycast (`~/SourceRoot/tinycast-extensions`, MacBook): the Claude usage menu bar/Detail/hub now carry the IU
  budget (`extension/src/usage/iu-budget.ts`) next to the two-account quota and routing views. Reuse its
  state words (ok / warn ≥ 80 % / over), its freshness rules (stale > 8 h, dead > 48 h) and its "can spend
  today / frees over 7 days" framing, so both surfaces read alike.

## Wave 1 — Audit and design spec (no product code)            <!-- status: active -->
- [ ] Audit the current page against live data (evidence/screenshot command, light + dark): what each section
      answers, what it fails to answer, what is noise, and the load/latency of each endpoint. Read Tinycast's
      usage views (code + AGENTS.md) for the vocabulary to share.
- [ ] Query usage-tracker's DB read-only (`sqlite3 ~/.local/share/usage-tracker/usage.db`) and Argo's `/usage/*`
      to establish which questions the data already answers: by source/sub_tool/model/project/account/payer,
      tokens split cache-read / cache-write / input / output, per day. Note the gaps (the portal tables are not
      synced; anything else missing).
- [ ] Write `docs/design/usage-tracking.md` v2: the three questions as the page's top band (IU cap gauge
      with can-spend-today and 7-day drop-off; two subscription headroom meters with pace; one "biggest
      movers" line), then the analysis sections. Spend and tokens should be one switchable lens over the same
      breakdowns, with a flow view (tool → sub-tool → model, sized by $ or tokens), a cache-efficiency view, a
      portal-vs-tracked reconciliation strip, and project attribution. For each section: the question, the
      chart kind from basalt's chart catalogue, the exact data contract, and the empty/stale states. Cut
      everything that answers no question.
- [ ] Specify the data work: a usage-tracker → Argo sync for `iu_portal_cost`/`iu_portal_total` (endpoint shape,
      idempotency, same `argoConfig`/`postJson` path as the other syncs), plus any aggregate endpoints the page
      needs so it never pulls raw records. Put the data steps into Wave 2 and the UI into Wave 3 below this
      wave (3–6 steps each).
- [ ] Commit the spec and the expanded plan, and stop for the owner's review of the spec. The orchestrator
      shows it to him before Wave 2.
**Left behind:**

## Wave 2 — Data: portal sync + aggregate endpoints            <!-- status: pending -->
(Written by Wave 1.)

## Wave 3 — The page            <!-- status: pending -->
(Written by Wave 1.)
