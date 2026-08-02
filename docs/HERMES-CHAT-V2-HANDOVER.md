# Hermes Chat v2 — handover to a fresh orchestrator

Rewritten 2026-08-02, mid-B2. Paste the block under "The prompt" as the opening message of a fresh
session. Everything below it is the state that block refers to.

This file is a **snapshot**, not a contract. The contract is
`docs/HERMES-CHAT-V2-ORCHESTRATION.md` and it has not changed. When this file and the running record
disagree, `docs/migrations/hermes-chat-v2.md` plus `git log` win — they are maintained, this is not.

---

## The prompt

> You are the orchestrator for the Hermes Chat v2 program, picking up mid-flight. Your operating
> contract is `~/SourceRoot/argo/docs/HERMES-CHAT-V2-ORCHESTRATION.md` — read it first and follow it
> verbatim, including its four mandatory reads.
>
> Then read `~/SourceRoot/argo/docs/HERMES-CHAT-V2-HANDOVER.md`. It records what has already
> happened, which of the specs' claims turned out to be wrong, and the environment's failure modes.
> Do not re-derive any of it — in particular the six AI SDK v7 corrections, which cost a research
> pass to establish and are not recoverable from the specs, because the specs are what got them
> wrong.
>
> Three things the contract cannot know:
>
> - **The task list does not survive a session.** `TaskList` is session-scoped. It will be empty.
>   Rebuild it from the phase list before doing anything else.
> - **`master` moves under you, in both repos.** During B1 a PR merged mid-flight, and a release was
>   published from `master` while the work sat on its branch — which shifted every version in the
>   plan by one. Re-read `git log` and `git fetch` immediately before committing, not only before
>   starting.
> - **A green report is a claim.** Three separate times this program has had something report a
>   failure the exit code contradicted, and once had a review tick that meant "did not run". Run the
>   thing and read `$?`.
>
> Your immediate work is finishing B2. Its foundation is committed on the `basalt-ui` branch
> `feat/agent-transcript`; three lanes remain. Start at step 1 of the phase loop.

---

## Where the program stands

| Phase        | State                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| P0           | Done. Committed and pushed to argo `master`                                        |
| P1           | Done. Duplication verdict is RENDER-ONLY; 25 of 26 register claims confirmed       |
| B1           | **Done. `basalt-ui@1.10.0` published to npm; argo consumes it; both repos pushed** |
| B2           | **In flight.** Foundation committed on `feat/agent-transcript`; three lanes left   |
| B3–B4, A1–A6 | Not started, blocked per the dependency graph                                      |

### The release ladder shifted by one — this is the single most important fact here

`1.9.0` was published from `basalt-ui` `master` carrying **only** the chart-layer batch (PR #42),
while B1 was still on its branch. So:

| Phase | Version                |
| ----- | ---------------------- |
| B1    | **1.10.0** (published) |
| B2    | **1.11.0**             |
| B3    | **1.12.0**             |
| B4    | **1.13.0**             |

Both program docs and `AGENT-CHAT-SPEC.md` have been renumbered to match. Versions are computed by
semantic-release from commit types, never chosen — if a doc and a published tag ever disagree again,
the tag wins.

### B2's state

Branch `feat/agent-transcript`, cut from `master` at `43862dc chore: release 1.10.0`. Two commits,
**unpushed**, working tree clean:

```
021c63e chore: adapt the playground agent demos to the new part shape
e967a45 feat: give every part a stable id and mirror v7's real tool lifecycle
```

Gates green at commit time: `fmt:check`, `lint` (exit 0), `typecheck`, `bun test` at
**1245 pass / 1 skip / 0 fail**, `make build`, `check-theme`. Verified independently, not just
self-reported.

**Landed:** `PartBase`/`id` on every variant; `offset` on text and reasoning; `mergePart`'s
identity-addressed splice-or-replace; `withPartIds`; the seven-state `ToolCallPart`; `ToolCallState`,
`TERMINAL_TOOL_STATES`, `isToolCallSettled`; `Drafted<T>`/`AgentPartDraft`; a rewritten
`parseAgentPart` that rejects the old flat tool shape; and `coalesceParts` moved out of
`thread-message.tsx` into a public `src/agent/coalesce.ts`.

**Three lanes left, on disjoint file groups:**

1. **Transport + hooks.** Rewrite `ai-sdk-transport.ts`'s `diffToolPart` to emit the real states, the
   nested approval envelope, and `durationMs` — it currently passes non-terminal states through flat
   as a deliberate placeholder, flagged inline. Mint deterministic ids (`${chatId}#${snapshotIndex}`,
   `tool#${toolCallId}`). Add `ResumableAgentTransport` + `isResumable` and move the resume gate at
   `use-agent-thread-runs.ts:337-341` onto it. Switch `useAgentStream` and `useAgentThreadRuns` from
   `push` to `mergePart`. Change `PartList`'s five `key={index}` sites to `key={part.id}`.
2. **Registry + chrome.** `src/agent/foreign.ts` (`ForeignPart`, `TranscriptPart`, `PartRenderers`,
   `definePartRenderers`, `PartRenderContext`); `ThreadTranscript`'s three-step resolution order
   (consumer renderer → `narrowAgentPart` → exhaustive switch → `fallbackRenderer`, which must never
   throw); `ToolChip`; `MessageBlock` memoization plus `coalesceParts` into a `useMemo`.
3. **Lifecycle.** Stop-preserves-the-partial-turn; `ChatMessage.finish`; un-skip (or delete) the
   `.skip`'d clobber reproduction at ~`:317` of `use-agent-thread-runs.test.tsx`; fix `stop()` setting
   `'done'` on a never-streaming thread while `stopAll()` sets no status at all.

Plus, before the PR: playground demos for the 1.11.0 gate, the `AGENT-CHAT-SPEC.md` §3 correction
(it still shows the wrong tool shape), and deferring the `mantine-shade-index` promotion note from
1.10.0 to 1.11.0 — it has now slipped twice and 1.10.0 shipped without it.

---

## The six AI SDK v7 corrections — do NOT re-derive, and do NOT trust the spec here

Established by reading installed source. `AGENT-CHAT-SPEC.md` §3 is **wrong** on all six and has not
yet been corrected. `ai@7.0.16` (basalt-ui) and `ai@7.0.18` (argo dashboard) have **byte-identical**
`dist/index.d.ts`, so the version difference is a non-issue.

What the spec got right: exactly seven tool states, no `'running'` state, `toolCallId` required on all
seven, `output`-only-on-`output-available` being genuinely expressible (the SDK uses
`common & (A|B|…)` with explicit `?: never` guards rather than flattening), and basalt owning
`durationMs`.

What it got wrong:

1. The error field is **`errorText`**, not `error`. No field named `error` exists in the union.
2. **Approval data is nested**, not flat: `approval: { id, approved?, reason?, isAutomatic?, signature? }`.
   The spec's `approvalId`/`approved`/`reason` siblings do not exist, and flattening silently drops
   `isAutomatic` and `signature`.
3. **`toolName` is not a field** on `UIToolInvocation`. For static tools it is encoded in the part
   discriminator `tool-${NAME}` and must be derived (`getToolName`/`getStaticToolName`); only
   `DynamicToolUIPart` carries it explicitly. basalt's own `ToolCallPart` keeps a required `toolName`
   — it just has to be derived at the transport boundary.
4. `preliminary?` is `output-available`-only; `rawInput?` is `output-error`-only and is the only
   surviving record of an input that never validated. The spec omits `rawInput`, `title`,
   `toolMetadata`, `callProviderMetadata`, `resultProviderMetadata`.
5. **`tool-output-available` carries only `output` on the wire.** The SDK re-supplies `input` by
   reading it back off the stored invocation. So merging by `toolCallId` is _required_, not the
   cosmetic anti-stacked-`<pre>` measure the spec describes — a merge that replaces rather than
   accumulates **loses the input outright**.
6. **`tool-approval-response` carries no `toolCallId`** and is resolved by reverse lookup on
   `approval.id`. A `toolCallId`-only merge index cannot handle it; an `approvalId → toolCallId` side
   index is required. `tool-output-denied` is thinner still — `toolCallId` alone.

**Design call already taken:** basalt's `ToolCallPart` **mirrors** the SDK's nested `approval` object
rather than flattening it, following the spec's own premise of mirroring v7 and avoiding a lossy
unwrap. Implemented that way in `e967a45`.

**Also settled:** the two approval states are fully wired through the standard `UIMessageStream` path
(stream-processor cases, `addToolApprovalResponse`, `sendAutomaticallyWhen`). Modelling them is not
speculative. Argo scoping approvals out is a _backend_ limit — only Hermes' `/v1/runs` exposes them —
and the two decisions are independent.

---

## Corrections to the specs carried forward from B1

**F3 is real, reproduces in production, and its mechanism is version-dependent.** Argo resolves
`@mantine/core@9.4.1`, whose `defaultProps` sets `keepMounted: true`, so `<Collapse>` renders through
`<Activity>` and collapse→expand wedges the thread. `basalt-ui` itself has `9.3.0`, where
`keepMounted` has no default and `undefined` falls through to plain children with no `Activity` at
all. Any test reaching the Activity boundary _through Mantine's `Collapse`_ silently does not
reproduce inside basalt-ui. Drive React's `<Activity>` directly.

**happy-dom replaces `TransformStream`/`WritableStream` with Node _classic_ streams** — same names,
different semantics — which breaks every `ai` streaming path with an error naming neither cause.
`tests/setup/dom.ts` restores the natives from `node:stream/web`, including the `AbortController`
family (restoring by halves created a brand mismatch that threw
`options.signal must be AbortSignal`). B2–B4 are entirely streaming work; check that restoration
first when a stream test fails inexplicably.

**A proposed subpath description that advertises exports which do not exist** is a recurring trap —
that string feeds `llms.txt`, `AGENTS.md` and a drift test. Ship a description covering only what
exists. Expect it again in every B phase.

**The spec's closing "What argo must do on the server side first" still needs reconciling.** Queued
in A6. Until then `HERMES-CHAT-V2.md` wins — it does **not** upgrade `apps/api` to `ai@7`, and does
**not** add a `skipCharacters` replay offset. Both are named failure modes in the contract.

---

## Environment failure modes

**`bun test` must run from the repo ROOT.** From a workspace subdirectory it does not find the root
`bunfig.toml`, so it runs with no DOM.

**There is no root `build` script in basalt-ui** — it is `make build`, or per-package.

**`check-theme` validates the last BUILT `dist`, not the working tree** — and so does the
playground's `typecheck`, which is the newer discovery: a stale `dist` reported green over source it
had never read, and only failed once `make build` ran. Build before trusting either.

**`lint` emits ~22 pre-existing warnings in basalt-ui and ~30 in argo, and EXITS 0.** Warnings are not
failures. A validation worker has twice reported `lint` as failing purely on warning text. Judge by
exit code.

**basalt-ui's commitlint enforces `scope-empty`** — `chore(playground):` is rejected where argo would
accept a scope. It also rejects an issue reference inside a bullet with `footer-leading-blank`;
reword rather than reaching for `--no-verify`.

**lefthook's `isolated-basalt-ui` hook forbids mixing `packages/basalt-ui/**`with`apps/**`or`docs/**` in one commit.** This forces multi-commit splits that cannot be collapsed. To amend a middle
commit without an interactive rebase (`-i`is unavailable here): detach at the target, amend, then`git rebase --onto <new-sha> <old-sha> <branch>`.

**oxfmt owns markdown in both repos and pads table separators**, contradicting the global
minimum-separator rule. The formatter wins mechanically. In argo, `bun run format` covers `apps/**`
and `packages/**` but **not** `docs/`, while lefthook checks `docs/` — so run
`bunx oxfmt --write <doc>` directly. (The glob is queued for repair in A6.)

**`basalt-ui`'s release is `workflow_dispatch` only** — merging does not publish. `make release`
dry-runs, reads the computed version back, and refuses a major. It honours `YES=1` to skip its TTY
confirmation, which its author added for scripted use; the major-refusal check runs before that
branch regardless.

**CodeRabbit can return "Review rate limited"** and still show a green check. A green review tick can
mean "did not run" — check for actual review comments.

**sideclaw's MCP transport drops**, and a job does not survive its HTTP server restarting (its own
repo is under active development). Reconnecting needs `/mcp` from the client, which the orchestrator
cannot invoke; ask Johannes. Never fall back to inline validation — delegate the gates to a subagent
instead.

**Never `ssh mini 'claude --bg …'`** — an ssh session cannot reach the login keychain; the daemon
comes up `Not logged in`, silently bills the API, and still looks healthy.

---

## What worked, and is worth repeating

**Adversarially verifying a review pays.** Of CodeRabbit's ten findings on B1, three were refuted:
one would have broken CI, one would have _weakened_ a test by deleting a real assertion, and one
rested on a premise that was false about its own file. The two that held were the valuable ones —
both made a brand-new hard check fail a _healthy_ consumer repo.

**Ask "is this claim true anywhere else?"** A verifier chasing one stale sentence found the identical
claim surviving in the README — the copy a human actually pastes.

**A per-lane scoped test is not a gate.** `bun test` neither typechecks nor lints nor format-checks.
A parallel fan-out that (correctly) forbids repo-wide validation mid-flight has no gate at all until
it converges; budget a remediation round.

**"What is wrong" and "what is missing" are different questions** and want different agents. A
correctness verifier found three broken gates; a separate completeness critic found a release
contract only ~57% delivered.

**A worker that pushes back is worth more than one that complies.** Brief them to say so when the
instruction is wrong, and mean it.
