# Group 2: Summary + type classification (DeepSeek)

## What You're Doing

Generate the per-thread **one-line summary** and **type classification** that populate the
feed rows, using the same fire-and-forget, idempotent pattern as the existing auto-titling —
one DeepSeek call (direct IU endpoint via `aiComplete`) that returns both, written under a
null guard so it runs once per thread. Backend only; the feed UI consumes it in Group 5.

---

## Research & Exploration First

1. `apps/api/src/routes/hermes.ts` — `titleThreadIfNeeded` (~lines 115–141), `deepseekTitle`
   (~70–78), `cleanTitle`, and where they're fired on `onFinish` (idempotent `isNull` UPDATE,
   skipped on abort/error). **Mirror this exactly.**
2. `apps/api/src/routes/ai.ts` — `aiComplete(prompt, { system, temperature, maxTokens })`
   returns a string (the model content). This is your seam.
3. `apps/api/src/db/schema.ts` — `HERMES_THREAD_TYPES` (from Group 1) + the `summary`/`type`
   columns.
4. `apps/api/src/routes/hermes.test.ts` — the titling tests (titled once, idempotent,
   doesn't clobber). Mirror them for summary/type.

---

## What to Implement

### 1. `summarizeThreadIfNeeded` in `hermes.ts`

A sibling of `titleThreadIfNeeded`, injectable like `generateTitle` (so tests can stub it):

```ts
// Returns { summary, type } from one DeepSeek call. Default impl uses aiComplete.
async function deepseekSummarize(
  userMsg: string,
  assistantMsg: string,
): Promise<{ summary: string; type: HermesThreadType }>
```

- One `aiComplete` call. Prompt the model to return a strict shape you can parse robustly —
  e.g. a single JSON object `{"summary": "...", "type": "..."}`. Parse defensively: trim code
  fences, `JSON.parse` in a try/catch, clamp `summary` length, and **coerce `type` to the
  allowed `HERMES_THREAD_TYPES`** (fall back to `'general'` on anything unexpected). Never
  throw out of the fire-and-forget path.
- Idempotent UPDATE guarded by `isNull(hermesThread.summary)` (same shape as the title guard).
- Fire it fire-and-forget on `onFinish` alongside titling; skip on aborted/errored turns.

Keep titling as-is (don't refactor it into this call). Note in RALPH_NOTES that summary is
generated once (not refreshed per turn) — refresh is deferred future work.

---

## Validation

```bash
bun test --cwd apps/api src/routes/hermes.test.ts
bun run --cwd apps/api typecheck
bun run lint && bun run format:check
bun test --cwd apps/api
```

Tests (mock `aiComplete`/the summarizer dep, like the titling tests): summary+type written
once on first finished turn; idempotent (second turn doesn't overwrite); unknown `type`
coerces to `'general'`; malformed JSON doesn't throw; skipped on aborted/errored turn.

---

## Commit

```
feat(hermes-chat): DeepSeek per-thread summary + type classification
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 2
```
