# Hermes Chat v2 — handover to a fresh orchestrator

Written 2026-08-02, at the end of B1's implementation. Paste the block under "The prompt" as the
opening message of a fresh session. Everything below it is the state that block refers to.

This file is a **snapshot**, not a contract. The contract is
`docs/HERMES-CHAT-V2-ORCHESTRATION.md` and it has not changed. When this file and the running
record disagree, `docs/migrations/hermes-chat-v2.md` plus `git log` win — they are maintained, this
is not.

---

## The prompt

> You are the orchestrator for the Hermes Chat v2 program, picking up mid-flight. Your operating
> contract is `~/SourceRoot/argo/docs/HERMES-CHAT-V2-ORCHESTRATION.md` — read it first and follow it
> verbatim, including its four mandatory reads.
>
> Then read `~/SourceRoot/argo/docs/HERMES-CHAT-V2-HANDOVER.md`. It records what has already
> happened, which of the spec's claims turned out to be wrong, and the environment's failure modes.
> Do not re-derive any of it.
>
> Two things the contract cannot know:
>
> - **The task list does not survive a session.** `TaskList` is session-scoped. It will be empty.
>   Rebuild it from the phase list before doing anything else; the per-phase bodies are recoverable
>   from `docs/HERMES-CHAT-V2.md` plus the corrections in the handover.
> - **`master` can move under you.** It did during B1 — a PR merged and was pulled mid-flight. Re-read
>   `git log` immediately before committing, not only before starting.
>
> Your immediate work is closing out B1, in this order: collect the pending review, act on it, walk
> the browser gate, then decide the PR with Johannes. B2 follows. Start at step 1 of the phase loop.

---

## Where the program stands

| Phase        | State                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0           | Done. Three commits on argo `master`, **unpushed** — pushing triggers RollHook and a rolling restart, which is Johannes's decision, not a commit decision |
| P1           | Done. Duplication verdict is RENDER-ONLY; 25 of 26 register claims confirmed                                                                              |
| B1           | **Implemented and committed, not closed.** Four commits on `basalt-ui` `feat/agent-chat-surface`, unpushed. See "What B1 still owes"                      |
| B2–B4, A1–A6 | Not started, blocked per the dependency graph                                                                                                             |

### B1's commits

On `feat/agent-chat-surface`, based on `basalt-ui` master `3958a3e`:

```
1144284 docs: record the agent-chat framework spec the B-phases build against
9ffa473 feat: prove the agent-chat subpath and the streaming wedge in the playground
006a2a4 feat: open ./agent-chat as its own door, and put the agent layer under test
ea04c6b test: give the repo a DOM harness so the agent layer can be tested at all
```

The four-way split is forced by lefthook's `isolated-basalt-ui` hook and cannot be collapsed. Its
allowlist was widened in the first commit to admit `bunfig.toml` / `package.json` / `bun.lock`
alongside `packages/basalt-ui/**`; `lefthook.yml` itself and `apps/**` are still excluded, so the
playground and the package can never share a commit.

### Gate results at commit time

All green: `fmt:check`, `lint`, `typecheck`, `build`, `check-coverage` (8/8), both generator drift
checks, and `bun test` at **1180 pass / 1 skip / 0 fail**, run twice with identical counts. The dist
gate (`pack-test.sh`) passed all 14 steps including `resolved basalt-ui/agent-chat` and
`export-surface snapshot OK` — the only evidence the new subpath resolves from the published
tarball, since the playground exercises `src/` and never `dist/`.

The single `skip` is deliberate and filed against B2.

## What B1 still owes

1. **A review that was submitted but never collected.** `mcp__sideclaw__review` job
   **`d10219f8-8947-42c1-b4cf-bc521930b976`**, scope `HEAD~4`, angles architect / senior-dev /
   typescript / qa / concurrency / api-contract / frontend. sideclaw's MCP transport dropped before
   it could be read. The job runs in sideclaw's always-on HTTP server and is durable across `/mcp`
   reconnects, so `job_wait({ jobId })` should still return it. If the job is gone, resubmit with
   the same scope and angles — the diff is committed, so nothing is lost. Fold findings in with
   `/commit --amend`, never as a follow-up fix commit.
2. **The browser gate, un-walked.** `bun run dev:playground` (not `bun dev` — see failure modes),
   then `/agent-chat-subpath` and `/agent-wedge`. On the wedge page the point is that the persisted
   `streaming` thread _resolves_; a wedged thread looks identical to a slow one.
3. **PR, merge, release.** `basalt-ui` is PR-required. Release only through `make release`, which is
   itself the gate — it dry-runs, reads the computed version back, and refuses a major.

**1.9.0 will carry the chart-layer batch too.** PR #42 merged into `basalt-ui` master during B1, and
`semantic-release-monorepo` analyzes every untagged commit touching `packages/basalt-ui/` since
1.8.0. Both changesets release under one version. If that is unwanted it is already too late; say so
rather than attempting to split it.

---

## Corrections to the specs — do not re-derive these

Every one was verified against installed source or production. The specs still contain some of the
original wording.

**F3 is real, reproduces in production, and the recorded mechanism is version-dependent.** Argo
resolves `@mantine/core@9.4.1`, whose `defaultProps` sets `keepMounted: true`, so its bare
`<Collapse expanded>` renders `<ChatView>` through `<Activity>` and collapse→expand wedges the
thread. But `basalt-ui` itself has `9.3.0`, where `keepMounted` has **no default** and `undefined`
falls through to plain children with no `Activity` at all. Consequence: any test reaching the
Activity boundary _through Mantine's `Collapse`_ silently does not reproduce inside basalt-ui. Drive
React's `<Activity>` directly — it is a stable named export of `react@19.2.7`.

**happy-dom replaces `TransformStream` with a Node classic stream.** `GlobalRegistrator.register()`
assigns `TransformStream = Stream.Transform` and `WritableStream = Stream.Writable` — same names as
the web-streams API, different semantics. The `ai` package constructs `TransformStream` at runtime
in its SSE parsing, so every streaming test breaks with an error naming neither cause.
`tests/setup/dom.ts` restores the native classes from `node:stream/web` after registration. B2–B4
are entirely streaming work; if a stream test fails inexplicably, check that restoration first.

**`AGENT-CHAT-SPEC.md` §1's proposed subpath description advertises exports that do not exist.** It
names `ToolChip` (1.10.0) and `ThreadFeedRow` (1.12.0). That string feeds `llms.txt`, `AGENTS.md`
and a drift test, so shipping it verbatim publishes a surface listing exports the tarball lacks. The
shipped 1.9.0 description covers only what exists. Expect the same trap in later phases.

**The spec's closing "What argo must do on the server side first" still needs reconciling.** Queued
in A6. Until then `HERMES-CHAT-V2.md` wins on any conflict — in particular it does **not** upgrade
`apps/api` to `ai@7`, and it does **not** add a `skipCharacters` replay offset. Both are named
failure modes in the orchestration contract.

**Two live defects found by writing B1's tests, both filed against B2:**

- `consumeAndFinalize` awaits `resolveOutcome` at `:219` then writes `setOutcome`/`setStatus` at
  `:221-222` without re-checking the supersede/abort guards from `:205-207`, so a `stop()` landing
  during that await is silently overwritten. A **verified-failing** reproduction ships as the
  `.skip`'d test at ~`:317` of `use-agent-thread-runs.test.tsx`. B2 must un-skip it or delete it; a
  dormant test with no owner rots.
- `stop()` unconditionally sets status `'done'` even for a thread that was never streaming, while
  `stopAll()` sets no status at all.

---

## Environment failure modes

**sideclaw's MCP transport drops.** Twice in one session — once with a job mid-flight, once
between calls. Reconnecting needs `/mcp` from the client, which the orchestrator cannot invoke; ask
Johannes. Submitted jobs survive, because they run in sideclaw's own HTTP server. Its repo has a
half-built `dispatch` tool in flight; editing it restarts the server. Do not fall back to inline
validation — delegate the gates to a subagent instead, which keeps the output off the orchestrator's
context and preserves the point of the offload.

**`bun dev` in `basalt-ui` races on a cold bunx cache.** It runs the playground and marketing in
parallel and both dev scripts begin with `npx kill-port` (Bun rewrites `npx` to `bunx`), so with an
empty cache the two race on linking the same binary: one gets `EEXIST`, the other a half-extracted
package. Structural, recurs whenever the cache is cold, unrelated to any code change. Use
`bun run dev:playground`.

**`bun test` from a workspace subdirectory does not find the root `bunfig.toml`**, so it runs with
no DOM. Run it from the repo root.

**`check-theme` validates the last BUILT `dist`, not the working tree.** After touching
`src/guard/**` or `src/cli/**`, `bun run build` before trusting it — a stale `dist` reports green
over source it never read. This is also why the CLI's `check-coverage` can fail while the
source-level equivalent passes.

**oxfmt owns markdown in both repos and pads table separators**, contradicting the global
minimum-separator rule. The formatter wins mechanically. Do not hand-fight it.

**commitlint rejects an issue reference inside a bullet** with `footer-leading-blank`. Reword rather
than reaching for `--no-verify`.

---

## What worked, and is worth repeating

**Adversarial verification paid for itself.** Eight implementation agents each self-reported success;
three had shipped code failing a CI gate they had not run — a `tsc` error, three lint errors, a
format break. A green scoped `bun test` proves nothing about `tsc`, `oxlint` or `oxfmt`.

**A parallel fan-out has no gate until it converges.** Forbidding repo-wide validation mid-flight is
correct — it would race half-written state — but it means the convergence step is where the only
real validation happens. Budget a remediation round after any parallel implementation phase; it is
not a surprise, it is the shape of the technique.

**"What is wrong" and "what is missing" are different questions.** The correctness verifier found
three broken gates. A separate completeness critic found that the release contract's "the full
`src/agent/**` suite" was about 57% delivered — three test files absent, all of them testable
against current code and gated on nothing. Neither would have found the other's findings.

**A worker that pushes back is worth more than one that complies.** One lane was told a suppression
comment was dead; it checked, found the directive was live, and said so instead of deleting it and
breaking lint. Briefs should invite that explicitly.
