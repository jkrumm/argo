# Hermes Chat — PRD

> **SUPERSEDED (2026-08-02) by `docs/HERMES-CHAT-V2.md`. Historical record only — do not build from
> this file.** A 2026-08-02 audit found the following claims below no longer true: the AI SDK is v7,
> not v5; diagrams render as bundled inline components, not in a sandboxed CDN iframe (that design
> was explicitly rejected in Phase B); `packages/charts` is retired; the Blueprint palette and
> `check-theme.mjs` are gone (basalt-ui zinc/sky, `bunx basalt-ui check-theme`); `/hermes/audio` was
> never built; audio-proxy was replaced by audio-gateway; there is no LiteLLM bridge; resumable
> streaming shipped rather than being deferred; the thread UX shipped as a single-column Slack feed,
> not list+detail; the Slack feed pane (Goal 9) was never built and never recorded as deferred; and
> the Hermes API is v0.19.1 with 33 routes, not ~v0.16.0.

A thread-first, Slack/WhatsApp-style chat surface inside the Argo dashboard that
talks directly to the Hermes agent core over its OpenAI-compatible API, built on
the **Vercel AI SDK v5** (transport) and **react-markdown + remend** (streaming,
Mantine-native rendering). Many lightweight threads with fresh-context starts and
shared long-term memory; rich rendering (fenced **smart `card` blocks**, Mermaid,
Vega-Lite, inline directives); **audio** (voice-in via STT, a mature PWA player,
read-aloud TTS); attachments; and a read-only Slack feed. Backed by a new
**general-purpose AI gateway** on the Argo API (DeepSeek v4 Flash + STT/TTS). Argo
owns the verbatim transcript in Postgres; Hermes owns compressed agent state.

> Status: validated E2E; ready for a two-phase `/ralph` loop. Group breakdown at
> the end. The "Verified Hermes API contract" + "Industry-pattern research" +
> "E2E validation" sections are ground truth. Wireframe:
> `docs/diagrams/ChatWireframe.svg`.

---

## Problem

Hermes is reachable today only through Slack. Johannes wants the chat experience
inside his own self-hosted PWA (Argo — Mac + iPhone): **many lightweight threads**
he can extend or start fresh, the agent still "knowing him" across threads, the
ability to see Slack (alerts etc.) in the same app, and far richer rendering than
plain text — semantic status/todo **cards**, charts, diagrams, **audio**.

Two architectural truths shape everything:

- **Slack is a peer adapter**, not a transport — talk to the Hermes core directly.
- **Hermes is not the database.** It stores only _compressed_ agent state per
  session id — so **Argo must own and persist the verbatim display transcript
  itself**. Hermes keeps the agent's memory; Argo keeps the record.

## Goals

1. **Thread-first chat**: thread list + thread view in a **responsive list+detail**
   layout (iPhone: list → full-screen → back; Mac: two-pane). "New chat" = fresh
   context; continuing preserves it.
2. **Direct transport** to Hermes `POST /v1/chat/completions` (SSE) via an Elysia
   proxy (bearer server-side), on **Vercel AI SDK v5** (`@ai-sdk/openai-compatible`
   - `createUIMessageStream` server, `useChat` client).
3. **Unified long-term memory** — stable, configurable `X-Hermes-Session-Key`.
4. **Argo owns the transcript** — verbatim messages in Postgres (Drizzle), modeled
   on the AI SDK `UIMessage` parts shape + an extension `payload`. Hermes owns
   compressed state keyed by `X-Hermes-Session-Id`.
5. **Rich rendering** via **react-markdown v10 + `remend`** (streaming-safe) with
   **Mantine-native** component mappings: markdown + GFM, fenced **smart `card`
   blocks** (`infra`/`todo`/`note`/`audio`), fenced **Mermaid**/**Vega-Lite**
   (sandboxed), inline `remark-directive` accents (`:badge[…]`, `==highlight==`),
   live tool-progress.
6. **Audio**: Voice Record → STT → editable composer text; a **mature PWA player**
   (MediaSession, background, scrub, speed) for agent-emitted audio; **read-aloud**
   via TTS. Audio is delivered through the same fenced ` ```card {type:"audio"} `
   convention.
7. **Attachments**: longform-text (markdown) popup now; File/Image/Camera later.
8. **General AI gateway** (`/ai/v1/*`, OpenAI-compatible): DeepSeek v4 Flash
   (LiteLLM EU bridge) for titling/classification + STT + TTS (audio-proxy).
9. **Slack visibility**: read-only feed pane reusing Argo's `/slack` routes.
10. Cross-device (Mac + iPhone) via Argo's PWA.

## Non-Goals

- No Slack-as-transport. No podcast/audio _generation_ in Argo (Hermes does it).
- No File/Image/Camera attachments in v1 (multimodal unverified).
- No hand-rolled SSE parser; no `@microsoft/fetch-event-source` (unresolved
  StrictMode bug). Raw `fetch`+`ReadableStream` is the only fallback.
- No resumable/interrupted-stream recovery in v1 (Valkey-backed; later).
- No Streamdown wrapper (Tailwind-flavored; clashes with Mantine/DESIGN.md) — we
  use its underlying streaming primitive `remend` with react-markdown instead.
- No Hermes Desktop build; no webhook/event-pipe (Option C); no `/v1/responses` or
  `/v1/runs`; no MDX; no multi-user model.

## Locked decisions

| Decision          | Choice                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it lives    | **New page in Argo** (`apps/dashboard` route + `apps/api` routes).                                                                                                            |
| Build scope       | **Full program, two phases** (core 1–6, then extensions 7–10).                                                                                                                |
| Memory model      | **Unified** — configurable `X-Hermes-Session-Key`, default Slack `#hermes` group key.                                                                                         |
| Prod transport    | **Tailscale** — Elysia (VPS) → Hermes tailnet IP:8642; bearer server-side.                                                                                                    |
| Thread UX         | **Responsive list+detail** (iPhone stack / Mac two-pane).                                                                                                                     |
| Streaming stack   | **Vercel AI SDK v5** — server `@ai-sdk/openai-compatible` + `createUIMessageStream`; client `@ai-sdk/react` `useChat`.                                                        |
| Rendering         | **react-markdown v10 + `remend` + Mantine-native** mappings. Hybrid syntax: fenced ` ```card `/` ```mermaid `/` ```vega-lite ` for blocks; inline `remark-directive` accents. |
| Smart cards       | Agent emits **fenced ` ```card ` JSON** (`type`: `infra`/`todo`/`note`/`audio`) → Mantine components; invalid → code-block fallback. DeepSeek only for titling.               |
| Audio             | STT voice-in + mature player + read-aloud TTS. Hermes audio via Argo `/hermes/audio` **range proxy with tailnet-host allowlist** (SSRF guard).                                |
| Argo AI endpoints | **OpenAI-compatible gateway** `/ai/v1/*` — DeepSeek v4 Flash + STT + TTS.                                                                                                     |
| Security          | Mermaid/Vega in sandboxed `<iframe sandbox="allow-scripts">` (no same-origin); `rehype-harden` + `rehype-sanitize` on LLM output.                                             |
| Testing           | API groups test against **mocked upstreams** (Hermes/audio-proxy/bridge); real E2E is manual.                                                                                 |

## Open product details (defaulted — veto on review)

- Card catalog v1: `infra` (ok/warn/err), `todo`, `note`, `audio`. Extensible;
  unknown → code-block fallback.
- DeepSeek titling: threads (from first turn) + card-title fallback. Non-blocking.
- Voice transcript: lands in composer for review/edit.

---

## E2E validation — adjustments from the coherence pass

1. **Auth resolves favorably.** Argo prod is **Tailscale-only + bearer `AuthGate`**
   (token entered at runtime via `eden.ts`/`useAuthStore`, not bundled). Exposing
   Hermes through it is acceptable. `useChat` streams outside Eden Treaty → its
   transport injects the bearer from `useAuthStore`.
2. **Cards live in markdown**, not a separate persisted structure — the renderer
   intercepts ` ```card ` in the assistant text. `payload` holds only audio refs +
   attachments (+ optional tool events).
3. **Audio uses the card path** (` ```card {type:"audio",title,src,durationMs} `);
   one render mechanism, not two. `/hermes/audio?src=` allowlists the Hermes
   tailnet host (SSRF).
4. **Mock upstreams in tests** so the autonomous loop self-validates without live
   cross-machine services (Hermes/audio-proxy/bridge); real E2E is manual.
5. **Proxy persists on `onFinish`** (Group 2); Group 4 = read-CRUD + titling +
   interrupted handling.
6. **Output shaping (Group 7) is Argo-side only** (per-request system preamble);
   the optional SOUL.md tweak is a separate manual `hermes-agent` task — the Argo
   loop must not edit another repo.
7. New routes use existing `tracedFetch`/OTel; verify **Traefik** doesn't buffer
   `/api/hermes/chat`. Group 1 resolves `<johannes_slack_user_id>` into
   `HERMES_SESSION_KEY`. Group 8 verifies iOS MediaRecorder format vs STT.

---

## Industry-pattern research & chosen stack (high-confidence, cross-verified)

Three deep research passes converged on the AI SDK v5 ecosystem; we take its
transport + streaming primitive but render Mantine-native. Pin exact versions at
install (respect bun cooldown; `/research` each before adding).

### Transport (SSE)

- **Server (Elysia):** `@ai-sdk/openai-compatible` `createOpenAICompatible({name,apiKey,baseURL})`
  calls Hermes (key server-side) → `createUIMessageStream`. Elysia returns the
  stream directly.
- **Client:** `ai` (v5.x) + `@ai-sdk/react` (v2.x) `useChat` + `DefaultChatTransport`
  → Elysia proxy. `prepareSendMessagesRequest` sends only the new turn (Hermes
  holds the rest via session-id).
- **Tool-progress tap:** the provider won't surface Hermes' `event: hermes.tool.progress`;
  the proxy taps raw SSE and injects them as **transient data parts**.
- **No-buffer:** `X-Accel-Buffering: no`, disable compression, `Bun.serve`
  `timeout(req,0)`; verify Traefik.

### Rendering (Mantine-native)

- **react-markdown v10** + **`remend` v1.3** (zero-dep streaming preprocessor that
  auto-completes unterminated fenced/format blocks mid-stream) + custom Mantine
  components via the `components` prop. (This is Streamdown's streaming magic,
  used standalone — no Tailwind.)
- **Smart cards:** custom code-block renderer for ` ```card ` → parse JSON, switch
  on `type` → Mantine card; invalid → `<Code>` fallback.
- **Diagrams/charts:** ` ```mermaid ` (mermaid) and ` ```vega-lite ` (vega-embed)
  rendered in a sandboxed `<iframe sandbox="allow-scripts">` via `srcdoc`; theme
  to DESIGN.md CSS-var tokens (`packages/charts` approach).
- **Inline accents:** `remark-directive` v3 for `:badge[…]` / `==highlight==`.
- **Security:** `rehype-harden` + `rehype-sanitize` on output (Mermaid CVE-2025-12029,
  Vega GHSA-7f2v-3qq3-vvjf → sandbox mandatory).

### Persistence

- **`threads` + `messages`** (Drizzle). `messages.parts jsonb $type<UIMessagePart[]>`
  - `messages.payload jsonb $type<MessagePayload>` (audio refs, attachments,
    optional tool events). Server IDs via `createIdGenerator({prefix,size})`.
- **Flow:** live stream in `useChat`; **persist final `UIMessage` in `onFinish`**;
  TanStack Query v5 mutation (optimistic) for the write + thread-list invalidate.
  Interrupted → `status:'interrupted'` partial.
- **Schema:** `threads(id, session_id, session_key, title, status, pinned?, archived_at?, created_at, updated_at)`;
  `messages(id, thread_id→fk, role, parts jsonb, payload jsonb, status, created_at)`;
  index `(thread_id, created_at)`.

---

## Verified Hermes API contract (ground truth)

Confirmed against `~/.hermes/hermes-agent/gateway/platforms/api_server.py` (~v0.16.0).

- **Endpoints:** `POST /v1/chat/completions`, `/v1/responses`, `/v1/runs`,
  `GET /v1/models`, `/v1/capabilities`, `/health`.
- **Port:** `8642` (`API_SERVER_PORT`/`API_SERVER_HOST`, default `127.0.0.1`).
- **Auth:** mandatory bearer `API_SERVER_KEY` (refuses to start without it / with a
  weak key when network-accessible). `/health` open.
- **Session headers:** `X-Hermes-Session-Id` (thread/transcript continuity; loads
  from `state.db`; echoed back); `X-Hermes-Session-Key` (long-term memory scope →
  Honcho `conversation_id`).
- **Streaming:** OpenAI SSE + custom `event: hermes.tool.progress`
  (`{tool,emoji,label,toolCallId,status}`), `: keepalive` 30s, `X-Accel-Buffering:no`.
- **Output shaping:** `role:"system"` message layers as ephemeral prompt over
  SOUL.md. Risk: SOUL.md's global Slack formatting may fight fenced/card output.
- **Unified key:** `group_sessions_per_user:true` →
  `agent:main:slack:group:C0ASRUD7K1U:<johannes_slack_user_id>`.
- **Enablement (Group 0, manual):** API server **not running** today; set
  `API_SERVER_KEY` (+ `API_SERVER_ENABLED=true`, tailnet `API_SERVER_HOST`,
  `API_SERVER_PORT`) in `~/.hermes/.env` + gateway restart.

## Reused infrastructure (exists)

Argo `/slack/*` routes (feed pane = frontend only); `authGuard` bearer +
Tailscale-only prod; **audio-proxy** `:7716` (STT/TTS); **LiteLLM bridge**
(DeepSeek-V4-Flash, EU); **Valkey** (resumable streams later); `tracedFetch`/OTel;
`eden.ts` Eden Treaty client + `useAuthStore`; `m365-explorer.tsx` (feed-pane
precedent); `packages/charts` (theming).

---

## Architecture

````
React PWA (Mantine + useChat)          Elysia API (VPS)                        Upstreams
 hermes-chat route                      /hermes/chat (AI SDK UIMessageStream)
  useChat (bearer from useAuthStore)─/api/▶ createOpenAICompatible ──Tailscale──▶ Hermes :8642 /v1/chat/completions
  react-markdown + remend (Mantine)       + session headers + raw-SSE tap            (session id / key)
   ```card ```mermaid ```vega-lite        + persist final UIMessage (onFinish)
   inline :badge ==hl== + tool chips     /hermes/audio (range, allowlist) ──TS──▶ Hermes-hosted audio
  audio player + read-aloud + voice      /ai/v1/chat|audio ──────────────────▶ DeepSeek bridge (EU) / audio-proxy
  thread list (TanStack Query)           /slack/* (exists) ──────────────────▶ Slack Web API (read-only feed)
                                         Postgres (Drizzle): threads, messages(parts, payload jsonb)
````

(Section detail — transport, gateway, persistence, rendering, audio, attachments,
slack, design conformance — as specified in the research/decision sections above.)

## Success criteria

1. PWA (Mac + iPhone): start/continue/new thread; response **streams** with live
   tool-progress; two-pane on Mac, stacked on iPhone.
2. Continuing preserves context; new = fresh; agent recognizes him across threads;
   threads auto-titled.
3. Reload restores the verbatim transcript (cards/audio/attachments) from Postgres.
4. ` ```card ` (infra) + ` ```card ` (todo) + ` ```mermaid ` + ` ```vega-lite `
   render **without mid-stream breakage** and **sandboxed**.
5. Voice transcribes into composer; podcast plays w/ lock-screen + scrub; read-aloud
   speaks a response.
6. Longform-text attachment reaches Hermes and persists/renders.
7. Slack feed pane shows recent activity/alerts (read-only).
8. Bearer tokens never appear in browser payloads.
9. `lint` + `format:check` + 3× typecheck + dashboard `build` pass; new API routes
   covered by `bun test:api` (mocked upstreams).

## Risks & open questions

- AI SDK ↔ Hermes custom-event tap (validate early); SSE buffering across Traefik/
  vite; Mermaid/Vega XSS → sandbox (non-negotiable); SOUL.md vs fenced output
  (possible cross-repo follow-up); multimodal deferred; audio playback needs Mac
  Mini awake (accepted); iOS PWA MediaRecorder/MediaSession quirks; dependency
  additions (pin/cooldown/`/research`); DeepSeek titling non-blocking; Slack user
  id needed for the key.

---

## Implementation prerequisites (manual bookends)

- **Group 0 (before Phase A):** enable + verify Hermes API server on the Mac Mini
  (env + restart); add `HERMES_API_KEY`/`HERMES_BASE_URL` + gateway secrets to
  `op://vps/argo/*`.
- **Dev infra up + `op` session:** `cd ~/SourceRoot/vps && make up`; needed for
  migrations/tests.
- **Between phases:** manual QA of the running core chat (Mac + iPhone) after
  Phase A.

---

## Implementation groups (two-phase `/ralph`)

Validation each group: `bun run lint` + `bun run format:check` + `tsc` typecheck
(api, dashboard, charts) + dashboard `vite build`; API groups add `bun test:api`
(mocked upstreams). Group 1 is foundation (compiles, no behavior).

### PHASE A — Core chat (Groups 1–6)

**Group 1 — Foundation & scaffolding.** Install + pin deps (`ai`, `@ai-sdk/react`,
`@ai-sdk/openai-compatible`, `react-markdown`, `remend`, `remark-gfm`,
`remark-directive`, `mermaid`, `vega`/`vega-lite`/`vega-embed`; `/research` each);
env/secrets wiring (`HERMES_*`, `/ai` gateway, `HERMES_SESSION_KEY` incl. resolving
the Slack user id); Drizzle `threads`+`messages` schema (parts/payload jsonb) +
migration; Elysia `/hermes` + `/ai` route stubs; `hermes-chat.tsx` route stub +
nav. **Compiles, no behavior.**

**Group 2 — Hermes chat proxy + persistence.** `POST /hermes/chat` (guarded):
`createOpenAICompatible` → Hermes over Tailscale (bearer + session headers);
`createUIMessageStream`; **raw-SSE tap** → tool-progress transient parts; no-buffer
headers + `timeout(req,0)`; **persist final UIMessage in `onFinish`**.
`GET /hermes/health`. **Tests vs mocked Hermes:** streams; bearer absent from
client data; tool-progress parts present; message persisted.

**Group 3 — General AI gateway (`/ai/v1/*`).** `/chat/completions` (DeepSeek v4
Flash, LiteLLM EU bridge), `/audio/transcriptions` (STT), `/audio/speech` (TTS),
`/models`. **Tests vs mocked bridge/audio-proxy:** auth enforced; EU routing for
DeepSeek; round-trips shaped correctly.

**Group 4 — Read CRUD + titling.** Thread/message read routes (list threads, get
messages); DeepSeek **thread auto-titling** (Group 3); interrupted-message handling.
**Tests:** thread list + transcript reproduce verbatim; titles generated.

**Group 5 — Frontend core chat (working chat!).** `useChat` → `/hermes/chat`
(bearer from `useAuthStore`, `prepareSendMessagesRequest` sends only new turn);
**responsive list+detail** (iPhone stack / Mac two-pane); react-markdown + remend
base render (markdown + GFM, Mantine); thread list/new/continue; TanStack Query
optimistic + persisted. **Acceptance:** start/continue/new on Mac + iPhone;
streaming visible; reload restores transcript.

**Group 6 — Smart cards + rich rendering.** Fenced ` ```card ` (infra/todo/note) →
Mantine cards via code-block override (invalid → fallback); `mermaid` + ` ```vega-lite `
in sandboxed iframe; `rehype-harden`/`rehype-sanitize`; inline `remark-directive`
accents; tool-progress chips from transient parts; DeepSeek card-title fallback.
**Acceptance:** success-criterion #4 renders without mid-stream breakage; sandboxed.

> **Phase A checkpoint:** manual QA the running core chat on Mac + iPhone before
> Phase B.

### PHASE B — Extensions (Groups 7–10)

**Group 7 — Output shaping (Argo-side).** Per-request `role:"system"` preamble
instructing fenced ` ```card `/mermaid/vega-lite (incl. `type:"audio"`) + inline
directives; validate vs SOUL.md. (SOUL.md tweak, if needed, is a separate manual
`hermes-agent` task — NOT this loop.) **Acceptance:** prompting reliably yields the
blocks Group 6 renders.

**Group 8 — Audio.** Voice Record → STT (Group 3) → composer (verify iOS
MediaRecorder format/transcode); `/hermes/audio` range proxy w/ tailnet allowlist;
` ```card {type:"audio"} ` → mature MediaSession player (background, scrub, speed);
per-message read-aloud → TTS. **Acceptance:** voice transcribes; podcast plays w/
lock-screen + scrub; read-aloud speaks; iOS PWA tested (manual).

**Group 9 — Attachments (longform text).** Markdown popup composer; attaches +
persists (`payload.attachments`). File/Image/Camera deferred. **Acceptance:**
attachment reaches Hermes and persists/renders.

**Group 10 — Slack feed pane.** Read-only feed UI consuming existing
`/slack/channels/unread` + `/channels/:id/messages` (m365-explorer precedent).
**Acceptance:** recent activity/alerts visible; read-only; no agent coupling.

### Later (not in either loop)

File/Image/Camera attachments; resumable/interrupted-stream recovery (Valkey);
Hermes-push-to-Argo audio storage; Hermes Desktop doc; outbound gateway-hook
alerts; thread search/archive/pin; channel/folder grouping; PWA push.
