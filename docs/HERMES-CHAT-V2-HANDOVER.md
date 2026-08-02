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
> Your immediate work is closing out B1: walk the browser gate, then decide the PR and the release
> with Johannes. The review is already collected and its findings applied. B2 follows. Start at step
> 1 of the phase loop.

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
e01aec6 docs: record the agent-chat framework spec the B-phases build against
6ea4bca feat: prove the agent-chat subpath and the streaming wedge in the playground
0762338 feat: open ./agent-chat as its own door, and put the agent layer under test
768a9ef test: give the repo a DOM harness so the agent layer can be tested at all
```

These four were rebuilt after review, so earlier SHAs quoted anywhere else are stale. Two of the
messages were rewritten rather than amended, because the review disproved a claim in one of them —
`./agent-chat` does not shed the eager `remend` resolution, and the original said it did.

The four-way split is forced by lefthook's `isolated-basalt-ui` hook and cannot be collapsed. Its
allowlist was widened in the first commit to admit `bunfig.toml` / `package.json` / `bun.lock`
alongside `packages/basalt-ui/**`; `lefthook.yml` itself and `apps/**` are still excluded, so the
playground and the package can never share a commit.

### Gate results at commit time

All green: `fmt:check`, `lint`, `typecheck`, `build`, `check-coverage` (8/8), both generator drift
checks, and `bun test` at **1196 pass / 1 skip / 0 fail**. The dist gate (`pack-test.sh`) passes,
including `resolved basalt-ui/agent-chat` and the new `agent-chat minimal-peer resolution` step —
the only evidence the new subpath resolves from the published tarball, since the playground
exercises `src/` and never `dist/`.

The single `skip` is deliberate and filed against B2.

Note the count moved during review (1180 → 1196) as findings were fixed and their tests added. If
you are comparing against a number quoted elsewhere, the git history is authoritative, not this
file.

## What B1 still owes

1. ~~**The review.**~~ **DONE** — both reviews collected, all findings applied, commits rebuilt. Two
   blocking findings, one from each reviewer, neither caught by the other: `./agent-chat`
   hard-requires `remend` and `motion` through static imports (now documented, tested, and gated by
   a new minimal-peer step in `pack-test.sh`), and the `ai-major-parity` guard hard-failed the
   topology D3 locks in (now declarable through the `basalt` config block with a mandatory reason
   string). Four smaller findings applied as well. The record below is kept for the failure modes it
   documents.

   Two are in flight over `HEAD~4`, deliberately redundant because sideclaw is
   unreliable right now: `mcp__sideclaw__review` job **`3a96beb1-4fc6-4723-8087-5361c6f84a5c`**
   (architect / senior-dev / typescript / concurrency / qa), and a native Opus subagent asked the
   same four questions directly. Collect with `job_wait({ jobId })`.

   The first attempt, `d10219f8-8947-42c1-b4cf-bc521930b976`, died at 965 turns with
   `HTTP server restarted while job was running` — sideclaw's own repo is being edited, which
   restarts its server and kills in-flight jobs. Note the asymmetry: a job survives an MCP
   _transport_ drop, because it runs in sideclaw's HTTP server; it does not survive that server
   restarting. Resubmit on `interrupted`; never fall back to inline validation.

   Fold any findings in with `/commit --amend`, never as a follow-up fix commit.

   The four questions both reviews were pointed at, because each is a place a plausible-but-wrong
   change survives a shallow read: does the F3 wedge test actually fail if the one-line fix is
   reverted, or does it pass either way; is `tests/setup/dom.ts`'s native-stream restoration
   complete and free of module-eval ordering hazards; do the three new oxlint rules' messages carry
   the trailing `(basalt/rule-id)` marker the fixture harness scrapes, without which every fixture
   passes vacuously; and does the new subpath's declared `optionalPeers` match what its import
   graph actually reaches.

2. **The browser gate, un-walked.** `bun run dev:playground` (not `bun dev` — see failure modes),
   then `/agent-chat-subpath` and `/agent-wedge`. On the wedge page the point is that the persisted
   `streaming` thread _resolves_; a wedged thread looks identical to a slow one.
3. **PR, merge, release.** `basalt-ui` is PR-required. Release only through `make release`, which is
   itself the gate — it dry-runs, reads the computed version back, and refuses a major.

**~~1.9.0 will carry the chart-layer batch too.~~ WRONG — it carried it alone.** This predicted that
PR #42's chart batch and B1 would release under one version, since `semantic-release-monorepo`
analyzes every untagged commit touching `packages/basalt-ui/` since 1.8.0. Instead 1.9.0 was released
from `master` at 14:48 UTC on 2026-08-02 — chart batch only — while B1 was still on its branch. **B1
ships as 1.10.0 and the whole ladder moves up one: B2 1.11.0, B3 1.12.0, B4 1.13.0.** The version
references inside B1's own commits were corrected before the PR; see the migration record.

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
names `ToolChip` (now 1.11.0) and `ThreadFeedRow` (now 1.13.0). That string feeds `llms.txt`,
`AGENTS.md` and a drift test, so shipping it verbatim publishes a surface listing exports the tarball
lacks. The shipped 1.10.0 description covers only what exists. Expect the same trap in later phases.

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
