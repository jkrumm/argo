# Hermes Chat v2 — handover to a fresh orchestrator

Rewritten 2026-08-03, at the B2/B3 boundary. Paste the block under "The prompt" as the opening
message of a fresh session. Everything below it is the state that block refers to.

This file is a **snapshot**, not a contract. The contract is
`docs/HERMES-CHAT-V2-ORCHESTRATION.md` and it has not changed. When this file and the running record
disagree, `docs/migrations/hermes-chat-v2.md` plus `git log` win — they are maintained, this is not.

---

## The prompt

> You are the orchestrator for the Hermes Chat v2 program, picking up at the start of B3. Your
> operating contract is `~/SourceRoot/argo/docs/HERMES-CHAT-V2-ORCHESTRATION.md` — read it first and
> follow it verbatim, including its four mandatory reads.
>
> Then read `~/SourceRoot/argo/docs/HERMES-CHAT-V2-HANDOVER.md`. It records what has already
> happened, which of the specs' claims turned out to be wrong, and the environment's failure modes.
> Do not re-derive any of it — in particular the AI SDK v7 corrections and the three transport bugs
> found by reading installed source, which cost a research pass and are not recoverable from the
> specs, because the specs are what got them wrong.
>
> Four things the contract cannot know:
>
> - **The task list does not survive a session.** `TaskList` is session-scoped. It will be empty.
>   Rebuild it from the phase list before doing anything else, and put each phase's acceptance
>   criteria in the task body rather than in your head.
> - **`master` moves under you, in both repos.** Re-read `git log` and `git fetch` immediately before
>   committing, not only before starting.
> - **A green report is a claim, and so is a green check.** Four times now this program has had
>   something report success that was not success: a lint "failure" the exit code contradicted, a
>   stale `dist` reporting green over source it had never read, five ad-hoc gates reported as the
>   repo's gate, and CodeRabbit twice returning "Review rate limited" behind a green tick. Run the
>   thing and read `$?`.
> - **Run the repo's own gate script, never a hand-assembled equivalent.** In `basalt-ui` that is
>   `bun run pre` (fmt + lint + typecheck + **check-theme**) plus `bun test` and `make build`. B2
>   shipped a `raw-surface` violation into a commit precisely because five commands were run
>   individually and `check-theme` was not one of them.
>
> Your immediate work is B3 (`basalt-ui` 1.12.0). B2 is closed and published. Start at step 1 of the
> phase loop.

---

## Where the program stands

| Phase     | State                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| P0        | Done. Committed and pushed to argo `master`                                  |
| P1        | Done. Duplication verdict is RENDER-ONLY; 25 of 26 register claims confirmed |
| B1        | Done. `basalt-ui@1.10.0` published                                           |
| B2        | **Done. `basalt-ui@1.11.0` published; argo consumes it; both repos pushed**  |
| B3        | **Next. Unblocked.** Ships as 1.12.0                                         |
| B4, A1–A6 | Not started, blocked per the dependency graph                                |

Release ladder, unchanged and now half-consumed: B1 → 1.10.0, B2 → 1.11.0, **B3 → 1.12.0**,
B4 → 1.13.0. Versions are computed by semantic-release from commit types, never chosen. If a doc and
a published tag ever disagree, the tag wins.

### What B2 actually shipped

Identity-addressed parts (`id` on every variant, `offset` on text/reasoning, `mergePart` splicing by
id, `PartList` keyed by `part.id`); the seven-state `ToolCallPart` mirroring AI SDK v7 with the nested
`approval` object intact; `ToolChip`; the foreign-part registry (`ForeignPart`, `TranscriptPart`,
`PartRenderers`, `definePartRenderers`, `narrowAgentPart`) with the `AgentPart` union still closed;
`ResumableAgentTransport` + `isResumable`; `MessageBlock` memoized at one re-render per delta;
`stop()` preserving the partial turn with `ChatMessage.finish`, rendered by `MessageBlock`. Plus the
`mantine-shade-index` guard promoted from `warn` to `error` after four minors of grace.

**1.11.0 is semver-breaking and shipped as a minor deliberately** — owner decision, taken with the
breakage enumerated. `id` is required on every `AgentPart`, `ToolCallPart` changed shape,
`AgentTransport`'s default generic changed, and `parseAgentPart` rejects the 1.10.0 shape. It landed
on argo clean **because argo imports zero from `./agent` and `./agent-chat`**. That debt is deferred,
not absent: A3 is where it gets paid.

---

## B3's scope — the seams

Spec: `~/SourceRoot/basalt-ui/docs/AGENT-CHAT-SPEC.md` §6, §7, §8 and the "1.12.0 — the seams"
release section.

- `Markdown` `fenceRenderers` + `settledOnly` + the `sanitizeSchema` extension +
  `BASALT_SANITIZE_SCHEMA` + `rehype-sanitize` as an optional peer.
- `remend` made lazy so the root entry stops hard-requiring it (**F2**).
- The settle fix in `threadPartRenderers.text` (**F1**) — the tail block must settle, which also
  un-hides `showCopy` on every finished message's final block.
- The full `Composer` prop set (the slots argo's voice layer re-mounts onto in A5).
- `ThreadsStoreAdapter` + `createAdapterThreadsStore` + `threadsStoreAdapterContract`;
  `ThreadsStore` gains `hydrated` and `error`.

Two locked design calls from the spec, do not quietly reverse them: **the sanitize hook is a data
extension, not a function** (a `(base) => Schema` callback can return `{}`; an additions-only object
cannot express removal), and basalt appends its sanitize pass **after** consumer `rehypePlugins` so
the escape hatch cannot outrun it.

### Carried into B3 from B2's reviews — decide these early

| Item                                                                                                                                                                                                                                                                                                                                                                                             | Where                                | Status                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `coalesceParts`' `mergeToolPart` uses a blind `{...existing, ...next}`, so fields the next state doesn't redeclare survive onto it. Plausible trigger: a tool streams `output-available` with `preliminary: true` and an output, then **fails** to `output-error` (no `output` key) → the merged part carries `errorText` **and** a stale `output`. The trailing `as ToolCallPart` cast hides it | `src/agent/coalesce.ts`              | Open. Fix = reconstruct per `next.state` instead of a two-way spread                                        |
| `spliceText` silently corrupts on an out-of-order offset, an offset past the current length, or a first insertion with a nonzero offset (that path ignores `offset` entirely). **Two independent reviewers landed on this**; neither could produce a live trigger, because `diffPart` always sets `offset = prevText.length` and `diffChunkStream` resets per call. The docs overclaim           | `src/agent/merge.ts`                 | Open. Either bounds-check and throw, or narrow the documented contract to the two shapes actually supported |
| `ToolCallBase.toolCallId` is a required always-meaningful string, but the approval-responded wire shape can arrive without one — so `coalesce.ts` smuggles "no id" through an empty-string sentinel and its test can only build that shape via `as unknown as ToolCallPart`                                                                                                                      | `src/agent/parts.ts`                 | Open. Model the missing-id case explicitly                                                                  |
| `typecheck` **excludes** `src/**/*.test.ts(x)`, so no test file is typechecked. Two test files have yield-position errors `tsc` would catch                                                                                                                                                                                                                                                      | `packages/basalt-ui/tsconfig.json`   | Open. Worth fixing, but expect a backlog on first enable                                                    |
| Should a **stopped** turn be resumable? Today `stop()` clears the resume token, so it is terminal. Deliberate — stopping is a user's "I don't want this", and resume exists for the involuntary case. Johannes raised it as a question                                                                                                                                                           | `src/agent/use-agent-thread-runs.ts` | Open question, behaviour change not bug fix. Do not slip it into a release quietly                          |

Test gaps worth closing in B3: `merge.ts` out-of-order and past-the-end offsets; three approval
rejection tests in `parts.test.ts` (`approval-requested` carrying `approved`/`reason`,
`output-available` and `output-error` with `approval.approved === false`); an `approval-responded`
part arriving **before** its matching `approval-requested` in `coalesce.ts` (the index is built
left-to-right while folding, so a responded part seen first cannot resolve — does a later request
reconcile the orphan, or create a second unmerged block?).

---

## The AI SDK v7 corrections — do NOT re-derive, and do NOT trust the spec's history here

Established by reading installed source. `AGENT-CHAT-SPEC.md` §3 **has now been corrected** and
matches reality, but any older restatement you find does not. `ai@7.0.16` (basalt-ui) and `ai@7.0.18`
(argo dashboard) have byte-identical `dist/index.d.ts`, so the version difference is a non-issue.

1. The error field is **`errorText`**. No field named `error` exists anywhere in the union.
2. Approval is **nested** — `approval: { id, approved?, reason?, isAutomatic?, signature? }` — with
   `approved` narrowed per state (`?: never` at `approval-requested`, `boolean` at
   `approval-responded`, `true` at `output-available`/`output-error`, `false` at `output-denied`).
   Flattening drops `isAutomatic` and `signature`.
3. **`toolName` is not a field.** Static tools encode it in the `` `tool-${NAME}` `` discriminator;
   only `DynamicToolUIPart` (`type: 'dynamic-tool'`) carries it explicitly. Derive with
   `split('-').slice(1).join('-')` — `split('-')[1]` truncates hyphenated names.
4. `preliminary?` is `output-available`-only. `rawInput?` is `output-error`-only **and
   static-variant-only** — `DynamicToolUIPart`'s `output-error` has no `rawInput`.
5. On a **message part** (which is what `aiSdkTransport` diffs), `input` is **required** at
   `output-available`; the SDK re-supplies it from the stored invocation. The "wire carries only
   `output`" correction is about the **chunk** and does not constrain this transport.
6. `tool-approval-response` carries **no `toolCallId`** and is resolved by reverse lookup on
   `approval.id`; the SDK throws if the request chunk was never applied. That mapping exists only in
   accumulated state, never on the wire. `tool-output-denied` carries `toolCallId` alone and has
   neither `output` nor `errorText` — its reason lives on `approval.reason`.
7. **`reconnectToStream` takes no `AbortSignal`** (deliberately asymmetric with `sendMessages`) and
   its runtime is a bare `GET` with no offset and no `Last-Event-ID`. This is why "do not fix the
   resume offset" is a fact about the SDK, not a hunch.

**Do not import `getToolName`/`getStaticToolName`/`isToolUIPart` as values**, even though `ai`
root-exports them. `ai-sdk-transport.ts` imports from `ai` **type-only by design** — it never
resolves the peer at runtime — so a value import would hard-require `ai` for every consumer.

### Three transport bugs found by reading the SDK, in no spec or register

All three are fixed, but they show what this class of code hides:

- **Dynamic tool calls were dropped entirely** — the default branch tested `startsWith('tool-')`,
  false for `'dynamic-tool'`. Not mislabeled; absent.
- **A state-equality short-circuit swallowed `preliminary` refinements**, so a streaming tool result
  froze at its first chunk. Invisible to any fixture that drives one transition per call — which was
  all of them.
- **`output-denied` has neither `output` nor `errorText`**, so the obvious "error if `errorText`,
  else done if `output`, else pending" chip logic renders a denied call as pending forever.

---

## What B2 proved about how to run this program

**Parallel lanes can each be honestly green while their combination is broken.** Two lanes both ran
the full suite, both passed, and the merge did not compile: one lane constrained the hooks to
`extends AgentPart`, the other introduced `TranscriptPart = AgentPart | ForeignPart`, and
`ForeignPart.type` is `string`. Shipped as-was, 1.11.0 would have advertised a part registry that
could not carry the parts it exists for. **A fan-out needs a convergence pass that tests the seam
between lanes, not the union of their diffs.**

**The lanes were not as disjoint as the previous handover claimed.** Two of three wanted the same
hook file; all three wanted the barrel. Verify disjointness against the tree before parallelising,
and assign shared files to exactly one lane with the orchestrator doing a convergence pass.

**Adversarial review pays, and so does bounding its scope.** An adversarial pass over code that
passed six gates found four blocking defects; a second review ran against the wrong scope (the
committed foundation, not the working tree) and its headline finding was already fixed. Read what a
review was pointed at before acting on it.

**Workers who push back are worth more than workers who comply.** In B2 they disproved a documented
tsc guarantee with a minimal repro, found a bug worse than the brief described, demonstrated that a
"no new ref needed" instruction was impossible, and correctly overrode a design instruction that
contradicted the file's own conventions. Brief them to say so, and mean it.

**The playground gate earns its cost because it is the first use from outside the package boundary.**
It found the hook constraint bug, and it found that `ChatMessage.finish` was persisted and rendered
by nothing — which had also hollowed out the spec's argument for not widening `ThreadStatus`.

---

## Environment failure modes

**Run `bun run pre` in basalt-ui, not a hand-assembled list.** It is fmt:check + lint + typecheck +
**check-theme**. Then `bun test` and `make build` separately.

**CI runs gates that no local command does.** `pack-test.sh` packs the tarball, installs it into a
scratch consumer, and diffs named exports per subpath against
`packages/basalt-ui/scripts/export-surface.json` — because publint and attw validate the export
_map_, not named-export completeness. Any new public export fails CI until that snapshot is updated:
`node --import ./packages/basalt-ui/scripts/css-noop-register.mjs
./packages/basalt-ui/scripts/export-surface.mjs --base ./packages/basalt-ui --update`, then
`bunx oxfmt --write` on it, because oxfmt owns that JSON and disagrees with the generator's
formatting.

**`bun test` must run from the repo ROOT.** From a workspace subdirectory it does not find the root
`bunfig.toml`, so it runs with no DOM.

**There is no root `build` script in basalt-ui** — it is `make build`, or per-package.

**`check-theme` and the playground's `typecheck` validate the last BUILT `dist`, not the working
tree.** Build before trusting either.

**`typecheck` excludes test files** (`src/**/*.test.ts(x)`), so a green typecheck says nothing about
test code.

**`lint` emits ~22 pre-existing warnings in basalt-ui and ~30 in argo, and EXITS 0.** Warnings are
not failures. Two validation workers have reported lint as failing purely on warning text.

**happy-dom replaces `TransformStream`/`WritableStream` with Node _classic_ streams** — same names,
different semantics. `tests/setup/dom.ts` restores the natives from `node:stream/web` including the
whole `AbortController` family. Check that first when a stream test fails inexplicably.

**`mergePart` collides on `undefined === undefined`.** Two parts yielded without an explicit `id` are
treated as one identity and spliced. A test that omits ids on multiple yields can mask the bug it
appears to cover — this happened twice in B2.

**basalt-ui's commitlint enforces `scope-empty`** — `feat(agent):` is rejected, use bare `feat:`. It
also rejects an issue reference inside a bullet via `footer-leading-blank`.

**lefthook's `isolated-basalt-ui` hook forbids mixing `packages/basalt-ui/**`with`apps/**`or`docs/**`in one commit**, which forces multi-commit splits.`rebase -i`is unavailable, so to amend
a middle commit: detach at the target,`commit --amend`, then
`git rebase --onto <new-sha> <old-sha> <branch>`. **basalt-ui is rebase-merge only**, so branch
commits land on `master` individually — their accuracy is not cosmetic.

**oxfmt owns markdown in both repos and pads table separators**, contradicting the global
minimum-separator rule. The formatter wins mechanically. In argo, `bun run format` covers `apps/**`
and `packages/**` but **not** `docs/`, while lefthook checks `docs/` — run `bunx oxfmt --write <doc>`
directly. (Queued for repair in A6.)

**basalt-ui's release is `workflow_dispatch` only** — merging does not publish. `make release-dry`
previews the computed version; `make release` refuses a major and honours `YES=1` to skip its TTY
confirmation.

**CodeRabbit returns "Review rate limited" behind a GREEN check.** A green review tick can mean "did
not run" — check for actual review comments before counting it.

**sideclaw's MCP transport drops mid-session**, and reconnecting needs `/mcp` from the client, which
the orchestrator cannot invoke — ask Johannes. It dropped during B2 after the reviews had returned.

**Never `ssh mini 'claude --bg …'`** — an ssh session cannot reach the login keychain; the daemon
comes up `Not logged in`, silently bills the API, and still looks healthy.

---

## Human gates still ahead

| Gate                                                      | Why                                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Before A2**                                             | D10 (moving to `/api/sessions/{id}/chat/stream`) was adopted on recommendation, not confirmed. If Johannes declines, A2 is dropped and A3's tool-chip source changes |
| **After B4, before A3**                                   | The framework API is now fixed. Getting it wrong costs a major                                                                                                       |
| **After A3**                                              | Manual acceptance on Mac _and_ iPhone                                                                                                                                |
| **Any npm publish**                                       | Outward-facing and irreversible. Johannes authorizes the release, not just the version                                                                               |
| **Any decision in `HERMES-CHAT-V2.md` turning out wrong** | State the finding, give two options with trade-offs, recommend one, ask                                                                                              |
