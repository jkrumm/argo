# Group 8: Usage-tracking (application=argo)

## What You're Doing

Capture the token usage of Argo's own AI calls (DeepSeek titling/summary via `aiComplete`, and
the chat proxy where the upstream returns a `usage` object) and record it into Argo's usage
pipeline tagged `application=argo`. First widen the `aiComplete` seam — it currently
**discards** the upstream `usage`. **Research the existing usage model before writing** — Argo
already has usage tables + routes; do not invent a new store.

---

## Research & Exploration First

1. `apps/api/src/routes/ai.ts` — `aiComplete()` returns only the content string and drops the
   upstream `usage`. The raw `POST /ai/v1/chat/completions` proxy passes `usage` through.
2. **Argo's existing usage infrastructure** — `grep -rn "usage_record\|usageRecord" apps/api/src`
   and read the usage routes/tests (`src/routes/usage.*.test.ts` exist: headline, breakdown,
   timeseries). Find the `usage_record` table in `schema.ts`, its columns (source/application,
   model, tokens, cost), and **how records are created** (is it ingested from the
   `usage-tracker` repo, or written in-process?).
3. **Cross-repo check (read-only):** `~/SourceRoot/usage-tracker` — its collector model + the
   `usage_record` shape + central pricing. Determine whether Argo should (a) write its own
   usage rows directly into the shared table, or (b) expose usage for the usage-tracker
   collector to pull. **If the recording requires a usage-tracker-side collector, that is
   out of this repo's scope — implement the Argo-side capture/emit and FLAG the collector work
   in RALPH_NOTES** rather than editing another repo.

---

## What to Implement

### 1. Widen `aiComplete`

Return the upstream `usage` alongside content (without breaking existing callers — e.g. a new
function or an overload that returns `{ content, usage }`, keeping the string-returning
behavior for the titler/summarizer or updating those call sites). Capture
`prompt_tokens`/`completion_tokens`/`total_tokens` + the model id.

### 2. Record tagged `application=argo`

Following whatever pattern your research in step 2 establishes (matching the existing
`usage_record` columns + pricing), record Argo's AI-call usage tagged so it's attributable to
`argo`. Reuse the existing table/route — do **not** create a parallel store. If a column for
the source/application already exists, use it; if the existing pipeline is pull-based from
usage-tracker, implement the Argo-side emit and document the collector follow-up.

Keep it observable and tested. Don't block on live DeepSeek — tests mock the upstream and
assert a usage row is recorded with the right tag/model/tokens.

---

## Validation

```bash
bun run --cwd apps/api typecheck
bun run lint && bun run format:check
bun test --cwd apps/api          # add a test: aiComplete usage captured + recorded tagged argo
bun run --cwd apps/dashboard typecheck
bun run --cwd apps/dashboard build
```

---

## Commit

```
feat(hermes-chat): record Argo AI-call token usage (application=argo)
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 8
```
