# Group 4: Read CRUD + DeepSeek titling

## What You're Doing

Expose the thread/message data the frontend needs, auto-title threads with DeepSeek
v4 Flash (via Group 3), and handle interrupted assistant messages. The proxy
already persists (Group 2); this group adds the read side + titling + lifecycle.

## Research & Exploration First

1. Re-read `docs/HERMES-CHAT-PRD.md` → Persistence + "Read CRUD + titling".
2. Read the Drizzle schema (Group 1), the proxy persistence (Group 2), and the
   `aiComplete` helper (Group 3).
3. Read an existing route's test (e.g. `apps/api/src/routes/*.test.ts`) for the DB
   test pattern.

## What to Implement

In `apps/api/src/routes/hermes.ts` (guarded):

- `POST /hermes/threads` → create a thread (mint `session_id`, set `session_key`
  from `HERMES_SESSION_KEY`), returns the row.
- `GET /hermes/threads` → list threads (newest first; include title, updated_at,
  pinned).
- `GET /hermes/threads/:id/messages` → ordered verbatim messages for a thread.
- `PATCH /hermes/threads/:id` → rename / pin / archive (minimal).
- **Auto-titling:** after the first assistant turn in a thread (hook into Group 2's
  `onFinish`, or a follow-up call), if the thread has no title, generate one with
  `aiComplete` (DeepSeek v4 Flash) from the first user+assistant exchange. Keep it
  **non-blocking** — never delay the stream; update the row when ready.
- **Interrupted messages:** if a stream ends without a finish, persist the partial
  assistant message with `status:'interrupted'` and the accumulated parts.

## Validation

```bash
bun run lint && bun run format:check
bun run --cwd apps/api typecheck && bun run --cwd apps/dashboard typecheck && bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
bun test --cwd apps/api
```

Tests (DB + mocked DeepSeek): create thread → persist a turn → list threads + fetch
messages reproduce it verbatim; titling produces a non-empty title via the mocked
gateway; an interrupted stream persists a `status:'interrupted'` row.

## Commit

```
feat(hermes-chat): thread/message read API + DeepSeek auto-titling + interrupted handling
```

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 4
```
