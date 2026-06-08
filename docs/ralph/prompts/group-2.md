# Group 2: Hermes chat proxy + persistence

## What You're Doing

Build the streaming proxy from Argo to Hermes and persist the verbatim transcript.
`POST /hermes/chat` calls Hermes' `/v1/chat/completions` via the AI SDK
(`@ai-sdk/openai-compatible`), streams a UI-message stream to the client, taps the
raw SSE for `hermes.tool.progress`, and persists the final message on finish. Tests
run against a **mocked Hermes** (no live Mac Mini).

## Research & Exploration First

1. Re-read `docs/HERMES-CHAT-PRD.md` → Transport + "AI SDK ↔ Hermes custom-event
   tap" + the verified SSE contract.
2. Verify AI SDK v5 server APIs (Context7/WebFetch): `createOpenAICompatible`,
   `streamText` / `createUIMessageStream` / `toUIMessageStreamResponse`, custom
   **transient data parts**, and how Elysia returns the stream (Elysia AI SDK
   integration). Confirm how to read the raw upstream SSE alongside the SDK.
3. Read `apps/api/src/routes/slack.ts` (Elysia route shape), `lib/traced-fetch.ts`,
   and the Drizzle schema from Group 1.

## What to Implement

### 1. `POST /hermes/chat` (guarded)

- Input: the new user message + a `threadId` (and the thread's `session_id`).
- Call Hermes via `createOpenAICompatible({ baseURL: HERMES_BASE_URL, apiKey: HERMES_API_KEY })`,
  injecting headers `X-Hermes-Session-Id` (thread) + `X-Hermes-Session-Key`
  (`HERMES_SESSION_KEY`). Send **only the new turn** (Hermes holds history).
- Produce a UI-message stream via `createUIMessageStream`. **Tap the raw upstream
  SSE** to extract `event: hermes.tool.progress` and write them as **transient**
  data parts (`{ type: 'data-toolProgress', transient: true, data: {...} }`) so the
  client shows live progress without persisting it.
- **No buffering:** set `X-Accel-Buffering: no`, disable compression on the route,
  and `Bun.serve` `server.timeout(req, 0)` for the connection.
- **Persist on finish** (`onFinish`): write the user message + the final assistant
  `UIMessage` (`parts` + `payload`) to `hermes_message` using server-generated ids
  (`createIdGenerator`). Touch the thread's `updated_at`.
- `GET /hermes/health`: lightweight upstream check (mockable).

### 2. Mock seam for tests

Make the Hermes base URL / fetch injectable so tests point at a local fake SSE
server (emit role chunk → content deltas → a `hermes.tool.progress` event → finish
→ `[DONE]`). Never call the real Hermes in tests.

## Validation

```bash
bun run lint && bun run format:check
bun run --cwd apps/api typecheck && bun run --cwd apps/dashboard typecheck && bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
bun test --cwd apps/api
```

Tests (mocked Hermes): the route streams deltas; the bearer/`API_SERVER_KEY` never
appears in client-visible output; a `data-toolProgress` part is emitted; the final
assistant message is persisted to `hermes_message`.

## Commit

```
feat(hermes-chat): streaming Hermes proxy with tool-progress tap + persistence
```

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 2
```
