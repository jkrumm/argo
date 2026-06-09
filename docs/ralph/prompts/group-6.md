# Group 6: Audio in/out (STT + TTS)

## What You're Doing

Wire the **already-existing** `/ai/v1/audio/*` API endpoints into the composer and transcript:
voice-record → **STT** to populate the input, and **read-aloud (TTS)** for assistant turns.
Persist audio refs on the message `payload`. The API endpoints exist (Phase A Group 3) — this
is frontend wiring + persistence, no new API routes.

---

## Research & Exploration First

1. `apps/api/src/routes/ai.ts` — `POST /ai/v1/audio/transcriptions` (multipart STT proxy) and
   `POST /ai/v1/audio/speech` (JSON → binary audio TTS proxy). Both 503 when
   `AUDIO_PROXY_BASE_URL` is unset. Note the request/response shapes (OpenAI-compatible).
2. The dashboard proxy: `/api/*` → API. So the browser calls `/api/ai/v1/audio/*`.
3. `apps/api/src/db/schema.ts` — the `AudioRef` type + `MessagePayload.audio` (already
   reserved on `hermesMessage.payload`).
4. `apps/dashboard/src/features/hermes-chat/` — the composer shell + action cluster from
   Group 5; `smart-card.tsx` `AudioView` ("coming soon" placeholder) → make it a real player.
5. Browser `MediaRecorder` API (research current usage); audio playback via `<audio>` /
   `Audio`.

---

## What to Implement

### 1. Voice record → STT (composer mic)

- Mic `ActionIcon` in the composer cluster: start/stop `MediaRecorder`, POST the blob
  (multipart) to `/api/ai/v1/audio/transcriptions`, insert the returned transcript into the
  textarea (append, don't clobber). Recording/uploading states + error toast on 503.

### 2. Read-aloud → TTS (assistant turns)

- A small "read aloud" `ActionIcon` on assistant messages: POST the text to
  `/api/ai/v1/audio/speech`, play the returned audio stream; play/stop state. Handle 503
  gracefully (hide or disable when audio unconfigured).

### 3. Persist audio refs

- When a turn includes audio (recorded input and/or generated speech), store an `AudioRef` in
  the message `payload.audio` via the existing persistence path. Render persisted audio with a
  themed player (replace the `AudioView` placeholder).

Graceful degradation: with `AUDIO_PROXY_BASE_URL` unset (local dev default), the mic/read-aloud
controls disable cleanly — never crash the composer.

---

## Validation

```bash
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run lint && bun run format:check
bun run --cwd apps/dashboard build
bun test --cwd apps/api          # if you touch API persistence/types, keep tests green
```

Manual-QA notes: record → transcript fills the input; read-aloud plays an assistant turn;
controls disable when audio-proxy unconfigured; persisted audio renders in a themed player.

---

## Commit

```
feat(hermes-chat): voice-record STT + read-aloud TTS in the composer
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 6
```
