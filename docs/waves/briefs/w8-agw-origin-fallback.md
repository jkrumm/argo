Branch: feat/gateway-origin-route-fallback
Title: feat(gateway): record who asked agw and mark route fallbacks on gateway rows
Owned files:
- packages/gateway/src/** and packages/gateway/test/** (reading the two headers into `lane_detail`)
- packages/capabilities/src/context.ts, packages/capabilities/src/transports/** and their tests (`origin` on `Attribution`, both headers on gateway calls)
- the place(s) that build a step's `Attribution` from its run (find them: `rootId`/`runId` are filled there) and their tests
- packages/opencode-host/** (the `model.request` plugin that adds the attribution headers; the balance fallback in `host.ts`)
- packages/host/src/workflows/review/ocr.ts, packages/host/src/workflows/review/index.ts (only where a balance failure falls back to another route)
- packages/audio/src/gateway.ts (the audio process's gateway headers)
- docs/gateway.md (§Callers and attribution, §Usage and telemetry `lane_detail` list), packages/gateway/README.md (headers table)

Task:
Repo `~/SourceRoot/agent-workflows`. Read AGENTS.md, docs/gateway.md and packages/gateway/README.md first. Context: Argo's
usage page v7 (spec `~/SourceRoot/argo/docs/design/usage-tracking.md`, §Data gaps 4 and 5; read-only for you) needs two
facts the gateway rows do not carry. Another lead works in the agent-workflows main checkout: you are in your own
worktree; never touch the main checkout.

1. **Origin (Gap 5).** Gateway rows carry the door caller (`agw`, `agw-opencode`), not who asked agw. The run's caller is
   known: the host door stamps `x-agw-caller` (`packages/host/src/auth.ts` `stampWho`) and it is stored as `runs.caller`
   (`claude-code`, `hermes`, `iris`, `macwhisper`, `cli`, …; a host-started run has `eval`/`drift`/`host`, see `callerOf`
   in `packages/middleware/src/usage.ts`). Carry it as `origin` on the step's `Attribution` (the root run's caller, so a
   child run reports who asked for the tree), send it as `x-agw-origin` on every gateway call (`gatewayHeaders` in
   `packages/capabilities/src/transports/headers.ts`, the OpenCode plugin, the audio process's gateway headers), and have
   the gateway store it as `lane_detail.origin` when it matches the caller pattern (`[a-z][a-z0-9-]{0,31}`), else drop it.
   It is attribution only: it never changes a pick.
2. **Route fallback marker (Gap 4).** When a Claude route's call through the gateway is refused for balance (the 402 with
   `x-agw-fallback: none`) and agw falls back onto its GPT route, the GPT call carries `x-agw-route-fallback: <the refused
   response's x-agw-request-id>`. Check that the gateway sets `x-agw-request-id` on that 402 and records the refusal in
   `usage.gateway_picks` with that request id; if it does not, make it so (the id must join a pick row). The gateway stores
   the header's value as `lane_detail.routeFallback` on the fallback call's row (validated as a request id the way the
   gateway mints them, else dropped). Every fallback site: `packages/capabilities/src/transports/http.ts` (the
   `isBalanceFailure` path), `packages/opencode-host/src/host.ts` (~line 768), `packages/host/src/workflows/review/ocr.ts`
   (~line 335) and `review/index.ts` (`onBalance`). Where a site cannot see the refused request id (OpenCode's error text,
   ocr's stderr), send `x-agw-route-fallback: unknown`, store `routeFallback: 'unknown'`, and say which sites do so in the
   report; prefer threading the real id where the response headers are reachable.
3. Both headers join the gateway's documented optional headers (docs/gateway.md §Callers and attribution, the README's
   headers table), are stripped before upstream like every `x-agw-*` header, and the `lane_detail` list in §Usage and
   telemetry gains `origin` and `routeFallback`.
4. Tests in the existing style: gateway stores/drops each header; `gatewayHeaders` emits `x-agw-origin`; the HTTP
   transport's balance fallback sends the marker with the refused id; the OpenCode plugin sends origin.

Not in scope: Argo, usage-tracker, deploy, `make verify` changes. Do not change `docs/concept.md`.

Validation: `bun test --isolate packages/gateway packages/capabilities packages/opencode-host` plus the touched host/audio
test files, then `make check` once at the end (it needs Postgres via `.env.test.tpl` + `secrets-run` on the mini; it is
the merge train's gate, so it must pass).
Finish: commit, push the branch (`git push -u origin feat/gateway-origin-route-fallback`), open a ready (not draft) PR
(GitHub). Report the PR URL and the validation output verbatim, and which fallback sites send a real id vs `unknown`.
Never touch files outside "Owned files". If the task needs one, stop and say which file and why. Probes of LLM endpoints
only through `opencode-safe` and `timeout`; no live calls are needed for this task.
