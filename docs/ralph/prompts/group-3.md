# Group 3: General AI gateway (/ai/v1/\*)

## What You're Doing

Stand up a small OpenAI-compatible AI gateway on the Argo API: DeepSeek v4 Flash
(via the LiteLLM EU bridge) for fast tasks like titling/classification, plus STT
and TTS (via the audio-proxy). The chat is the first consumer (titling in Group 4,
audio in Phase B). Tests run against **mocked upstreams**.

## Research & Exploration First

1. Re-read `docs/HERMES-CHAT-PRD.md` → General AI gateway section.
2. Confirm the audio-proxy endpoint shapes (OpenAI-compatible
   `/v1/audio/transcriptions` multipart, `/v1/audio/speech`) and the LiteLLM
   bridge chat shape — verify rather than assume; both are OpenAI-compatible.
3. Read `apps/api/src/routes/slack.ts` + `env.ts` (the optional gateway vars from
   Group 1) + `lib/traced-fetch.ts`.

## What to Implement

In `apps/api/src/routes/ai.ts` (guarded), OpenAI-compatible:

- `POST /ai/v1/chat/completions` → proxy to `DEEPSEEK_BASE_URL` with
  `DEEPSEEK_API_KEY`, default model `DEEPSEEK_MODEL` (`DeepSeek-V4-Flash`). Support
  non-stream (titling uses non-stream); streaming optional. Keep EU routing.
- `POST /ai/v1/audio/transcriptions` (multipart audio in) → audio-proxy STT
  (`AUDIO_PROXY_BASE_URL`).
- `POST /ai/v1/audio/speech` (text in, audio out) → audio-proxy TTS.
- `GET /ai/v1/models` → advertise the available model(s).
- Use `tracedFetch`; never leak upstream keys to the client.

Provide a thin internal helper (e.g. `aiComplete(prompt)`) that Group 4's titling
can import without going back through HTTP.

## Validation

```bash
bun run lint && bun run format:check
bun run --cwd apps/api typecheck && bun run --cwd apps/dashboard typecheck && bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
bun test --cwd apps/api
```

Tests (mocked bridge + audio-proxy): auth enforced (401 without bearer); a DeepSeek
completion round-trips and stays EU-routed; an STT and a TTS request reach the
audio-proxy with the right shape; upstream keys absent from responses.

## Commit

```
feat(hermes-chat): OpenAI-compatible AI gateway (DeepSeek v4 Flash + STT + TTS)
```

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 3
```
