# Hermes Chat v2 — migration record

What actually shipped, what was deferred, and what surprised us. Written as the program runs, not
at the end. This file plus `git log` is what the next orchestrator reads to know where things stand
— the spec (`docs/HERMES-CHAT-V2.md`) states intent, this states reality.

Program spec: `docs/HERMES-CHAT-V2.md`. Framework spec: `~/SourceRoot/basalt-ui/docs/AGENT-CHAT-SPEC.md`.
Orchestration contract: `docs/HERMES-CHAT-V2-ORCHESTRATION.md`.

---

## 2026-08-02 — program start

### State at boot

| Repo        | HEAD                               | Working tree                                                              |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `argo`      | `31e8e50` on `master`              | Dirty — 15 tracked files (147 ins / 68 del), 2 untracked docs (569 lines) |
| `basalt-ui` | `6c568ae` (`chore: release 1.8.0`) | Clean but for untracked `docs/AGENT-CHAT-SPEC.md` and a local `.claude/`  |

Task list created: 12 phases (P0, P1, B1–B4, A1–A6) with the dependency graph from the spec.

### Decisions taken

**D10 CONFIRMED** by Johannes at program start, ahead of its formal gate. The Hermes transport moves
to `POST /api/sessions/{id}/chat/stream` (phase A2), so A3's tool chips are fed real
`tool.started/completed/failed` events carrying arguments — not reconstructed client-side. The A2
human gate is cleared; no further ask needed.

**P0 commit split** delegated to the orchestrator ("i dont care about the commits"). Landing as three
commits, one per concern: `chore(deps):` (the 1.8.0 sync + the two edits its new guard forced),
`style(strength):` (timer phase colors), `docs:` (the V2 docs + the superseded banners).

### Surprises

**1. `DESIGN.md` is not sync content.** The P0 phase description assumed it was part of the
`basalt-ui sync` output. It is not: its hash line in `.basalt/manifest.json` is _unchanged_ in the
diff, meaning `sync` never touched or re-recorded it. It is a basalt `seed` file — written once by
`basalt-ui init`, then owned by argo. Its diff is two hand-written series rows (`timerWork`,
`timerRest`) belonging to the strength-timer work, so it commits with that, not with the deps bump.
Anyone splitting a future basalt sync should check the manifest hashes rather than trusting the
file list.

**2. Two of the four "unrelated" dashboard edits were sync fallout.** basalt-ui 1.8.0 splits
`shadow-card` into three depth tiers and adds a `mantine-shade-index` guard. `explorer-page.tsx`
(`var(--mantine-color-blue-5)` → `VX.accent`) and `voice/recording-indicator.module.css`
(`var(--mantine-color-red-6)` → `var(--vx-bad-solid)`) are exactly the shade-pinned-var pattern that
guard prescribes fixing, so they belong with the upgrade. `timer-card.tsx` genuinely is not — its
removed comment self-flags the deviation as "not caught by the mechanical guard (plain object, not a
JSX accent prop)", i.e. pre-existing debt.

**3. `AGENT-CHAT-SPEC.md`'s closing section is stale and contradicts the program spec.** Its
"What argo must do on the server side first" says _"upgrade `ai` 5 → 7"_ and _"pass `skipCharacters`
from `Last-Event-ID`"_. Both are wrong per `HERMES-CHAT-V2.md` D3 (the API stays on v5; the skew
costs one enum value, neutralized by a producer-side `TransformStream`) and per the defect-1 /
resume-offset correction (v7's `reconnectToStream` is a bare GET that sends no `Last-Event-ID` and
no offset, so there is nothing to skip from). The section also cites synthesis D-numbers (5/6/8)
that do not match the V2 spec's D-numbers. These are two of the three named failure modes in the
orchestration prompt, sitting in a doc an implementer would reasonably follow. **Queued as a fix in
A6.** Until then: `HERMES-CHAT-V2.md` wins on any conflict.

**4. `sideclaw` is under active development, so the validation lane is unreliable.** Its working
tree carries a half-built `dispatch` tool (`server/jobs/handlers/dispatch.ts`,
`server/mcp/tools/dispatch.ts`, `server/skills/dispatch.md` untracked; `mcp.ts`, `executor.ts`,
`types.ts`, `session-runner.ts` modified). The first `check` job died at turn 19 with "HTTP server
restarted while job was running", and the MCP server then dropped out of the session entirely.
Reconnecting requires `/mcp` from the client side. **P0's commits are held pending a green gate**
rather than falling back to inline validation. Not our work to land — leave it alone.

**5. `basalt-ui` is parked on an empty feature branch.** `feat/linewatch-chart-gaps` is 0 ahead / 0
behind `master`, i.e. a branch created and never used, and five other `feat/*` branches have `gone`
upstreams. B1 should branch from `master`, not from wherever the checkout happens to sit. The
untracked `.claude/` there holds `settings.local.json` and six e2e screenshot PNGs and is _not_
gitignored — worth a `.gitignore` entry at some point, but not in this program's scope.

## P1 — forensics

Six read-only lanes re-verified all 26 claims in the defect register against current source and
production, plus the v5→v7 wire skew read out of installed `node_modules` rather than memory.

### The duplication verdict: RENDER-ONLY

```sql
SELECT thread_id, role, status, count(*)
FROM argo.hermes_message
GROUP BY 1, 2, 3
HAVING count(*) > 1;
```

**0 rows**, 2026-08-02. Unfiltered, the same grouping returns 10 groups all of `count = 1` — the max
group size is 1, not merely under 2 — and every row is `status = 'complete'`, so defect 5's
interrupted-turn row has never been written.

So **defects 2 and 3 are the live symptom; defects 4 and 5 are unevidenced hardening.**

The caveat has to be recorded with the result: the table holds 10 rows across 5 threads (2 per
thread) with nothing newer than 2026-06-18. That is a near-dormant write path. The empty result is
_consistent with_ render-only duplication; it is not proof the write path is safe.

Consequence for A1: the two changes it already calls highest-value — the `finishReason`
`TransformStream` and persisting the user turn at stream start — ship first and independently. The
idempotency migration follows, and is no longer urgent.

### Register health: 25 of 26 CONFIRMED

Every library citation held when read out of installed `node_modules`: `ai@7.0.18`
`ui-message-chunks.ts:193-202` and `chat.ts:656-657`, `@ai-sdk/react@4.0.19 dist/index.js:361-364`,
`@ai-sdk/openai-compatible@1.0.39 :172/:485/:712-716`. The audit's own self-refutation of the F3
unmount/remount variant also held. Total staleness across 26 items: two line-number drifts
(`traced-fetch` `:43-56` → `:53-55`, F3 `:329-331` → `:328-331`). For a five-day-old register that
is good — the risk in this program was never rot.

### The one REFUTED claim, and it is the expensive one

**`client_message_id` does not exist as a column.** Defect 4 and phase A1 both read as though only
the _index_ were missing. Verified against production `information_schema` and
`apps/api/src/db/schema.ts:453-471`: `argo.hermes_message` has exactly 7 columns — `id`,
`thread_id`, `role`, `parts`, `payload`, `status`, `created_at` — and exactly 2 indexes,
`hermes_message_pkey` UNIQUE(`id`) and the non-unique `idx_hermes_message_thread_created`.
`grep client_message_id` across `apps/api` and `apps/dashboard` returns nothing.

An implementer sent to "add the unique index" would have found nothing to index and been forced to
redesign the request contract mid-phase. The real shape is four steps: read the client's
`UIMessage.id` out of the body (`messages: z.array(z.unknown())` at `hermes.ts:290` keeps it opaque;
`hermes.ts:455` always mints a server id) → migration adding a nullable column → **partial** unique
index `WHERE client_message_id IS NOT NULL` (a plain unique index over a nullable column would
silently not constrain the existing rows) → only then `ON CONFLICT DO NOTHING`.

### Other corrections that change scope

| Finding                                                                                                                      | Effect                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` runs `runMigrations()` at `:48` and `.listen()` at `:264` at module scope                                         | A1 must extract an exported `buildApp()` factory before defect 17's test can exist at all                                                                                                            |
| `ai.test.ts:135` does **not** guard mount order — it composes its own `new Elysia().use(authGuard).use(createAiRoutes(...))` | Nothing in the repo imports the composed app. Defect 17 needs two tests, not one                                                                                                                     |
| `chat-conversation.tsx:277` already blocks a send while streaming                                                            | Drop "+ composer guard" from defect 5. The 409 stays; the guard is built                                                                                                                             |
| Hermes does **not** cap request bodies at 10 MB                                                                              | That figure is `max_file_size_mb: 10` under `checkpoints:` — a snapshot limit. The only attachment cap is 32 MB scoped to `discord:`. Pick A1's cap on Argo's own terms against Bun's 128 MB default |
| Failed AI calls write **no row at all** (`ai.ts:174-177` throws before the recorder at `:186`)                               | Defect 20 is a missing denominator, not a wrong label. Fix = optional `billing`/`outcome` on `RecordUsageParams` **plus** recording on the error paths                                               |
| The retry wraps `doStream`, which resolves at response-headers time                                                          | Defect 7's window is a retryable _pre-stream_ failure, not mid-stream. `maxRetries: 0` still lands, narrower than written                                                                            |
| Tool events **are** persisted (`buildMessagePayload` returns `{ toolEvents }`, `hermes.ts:424-428`, written at `:459`)       | Defect 11 is a render gap, not data loss — `toUIMessages` (`chat-view.tsx:14-27`) spreads only `{ audio, attachments }`. A3 can backfill historical threads into the new chips for free              |
| `showToolProgress` defaults `true` and is **persisted** via `partialize` (`store.ts:43`, `:54`)                              | Anyone who toggled it off before the header vanished is stuck off. A3's "closes 10 and 11 by construction" only holds if it resets/ignores the flag or restores a reachable toggle                   |

### F3 is not a dev-only bug

The register scoped it to React 19 StrictMode. It reproduces **in production**. `controllersRef`
survives StrictMode's double-invoke because React reuses the fiber
(`doubleInvokeEffectsOnFiber`, `react-dom-client.development.js:18697-18707`) — and React 19.2's
`<Activity>` does the same thing, destroying and re-creating effects while preserving the fiber's
refs. Mantine v9 `Collapse` defaults `keepMounted: true` and renders through `Activity`, and Argo
mounts `<ChatView>` inside a `<Collapse>` (`thread-feed-row.tsx:82-91`). Collapse → expand wedges
the thread.

B1's test must therefore exercise an `<Activity>` hide/show boundary, not just a StrictMode
double-mount, and the fix must clear the Map in the unmount effect rather than rely on the sweep.

**F1 also grew**: the same root cause hides the copy action on every finished message's final block
(`fence-block.tsx:34` gates `showCopy={settled}`), and there is no consumer escape hatch —
`MarkdownProps` exposes no `settled`. Its fix is a public-API addition, not a one-liner.

**F4 shrank**: `bun test` is already wired and 56 suites run under it. What is missing is a _DOM_
harness, not testing from zero.

### Operational blocker found in passing

`~/vps/Makefile:425` `shell-postgres` is dead on the prod box. `$${POSTGRES_USER}` /
`$${POSTGRES_DB}` are expanded by the recipe shell _before_ `op run` execs, and the prod `.env`
holds only `ENV=prod`, so psql runs as `psql -U -d <db>` → `FATAL: role "-d" does not exist`. Fix is
to defer expansion into the shell `op run` spawns:

```make
$(OP_RUN) sh -c 'docker exec -i postgres psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'
```

Outside this program's scope (`vps` is a different repo), but anyone verifying A1's migration
against prod hits it first.

---

## P0 — landed

Three commits on `master`, each one concern, all green through lefthook (oxfmt + oxlint +
check-theme):

```
2a84432 docs: supersede the Hermes chat PRD with the v2 spec
d239168 style(strength): drive timer phases from the series dictionary
ac90650 chore(deps): upgrade basalt-ui to 1.8.0
```

**Not pushed** — pushing argo triggers RollHook and a rolling restart on the VPS, which is a
deploy decision, not a commit decision.

### A leaked Tailscale IP, caught one commit before it was permanent

`HERMES-CHAT-V2.md:57` carried a real tailnet address in the "why the proxy is not optional"
table: `` `lsof` → `100.87.73.3:8642 (LISTEN)` ``. The global security rule forbids real IPs,
Tailscale IPs and internal service URLs in any git-tracked file. The doc was still untracked, so
nothing had leaked; it is now `<tailnet-ip>:8642`, which costs the reader nothing — the load-bearing
claim is "binds the tailnet IP only, no TLS", not the address.

A full scan of all four program docs found this as the only hit: no other private-range IPs, no
token/key/secret-shaped strings. Worth repeating the scan before any future doc commit in this
program, since these docs quote a live-infrastructure audit.

### The 21 lint warnings are pre-existing, not this upgrade's fallout

`bun run lint` fails with 21 warnings across 12 files, none of them touched by P0. Ruled out as
upgrade fallout rather than assumed: the only change to basalt's shipped oxlint preset between
v1.6.0 and v1.8.0 is one added rule (`basalt/raw-size-literal`, at `warn`), which produces zero hits
in argo. The `unicorn`/`eslint` category settings are identical, and `oxlint` does not appear in the
lockfile diff.

They arrived when `oxlint` floated to 1.64.0 under its `^1.60.0` caret at an earlier install —
`no-array-sort`, `no-array-reverse` and friends are newer rules landing inside already-enabled
categories. **That caret is itself a house-rule violation** (dependency-hygiene: pin exact versions
for direct dependencies so every upgrade is deliberate) and is exactly the failure mode the rule
exists to prevent. Pinning it and clearing the 21 warnings is separate, deliberate work — not
something to smuggle into this program.

### oxfmt formats markdown, and it pads tables

The third commit was rejected by lefthook on first attempt: oxfmt owns `.md` in this repo, and it
rewrites table separators to the padded `| --- | --- |` form. That directly contradicts the global
formatting rule ("use minimum separator `|-|-|`, never pad with repeated hyphens"). The formatter
wins mechanically, so in argo — and any oxfmt repo — that rule is unenforceable. Either scope the
rule to exclude oxfmt-managed repos or turn off oxfmt's markdown table handling; do not hand-fight
the formatter.

---

## B1 — basalt-ui 1.9.0

Branch `feat/agent-chat-surface`, cut from `master`. Four implementation lanes on disjoint file
groups: the DOM harness, the `./agent-chat` subpath, the oxlint guards + doctor check, and the F2
remend pin — with the `src/agent` test suite chained behind the harness and the playground gate
chained behind the subpath.

### Corrections to the pre-flight record, found before writing a line of code

**1. `feat/linewatch-chart-gaps` is not an unused branch.** The P0 note recorded it as "0 ahead / 0
behind `master`, i.e. a branch created and never used". It is 10 commits ahead, pushed, and carries
**open PR #42** (`feat: close the chart-layer gaps a data-honesty consumer found`, opened
2026-08-02). Branching B1 from `master` was right for a different reason than the one recorded: not
because the branch was empty, but because it is someone else's in-flight PR.

The overlap is small but real. PR #42 touches `packages/basalt-ui/src/cli/index.ts` (+159),
`src/guard/index.ts`, `packages/basalt-ui/package.json`, `CLAUDE.md` and `docs/STATUS.md`. It does
**not** touch `configs/oxlint-plugin.js`, `src/surfaces.ts` or `src/agent/**`. B1's only collision
is the CLI, where the `ai-major-parity` doctor check lands. Whichever merges second rebases there.

Practical trap this created: a scout sent to read the CLI on that branch reported `checkCoverage` at
`:1393` and `doctor` at `:1587`. On `master` they are `:1244` and `:1438` — everything after the
chart CLI additions shifts by ~150 lines. Anchors read off a feature branch are not anchors.

**2. The F3 production claim is right, but its stated mechanism is version-dependent — and the two
repos disagree.** P1 recorded "Mantine v9 `Collapse` defaults `keepMounted: true` and renders
through `Activity`". That is true of `@mantine/core` **9.4.1**, which argo resolves, whose
`defaultProps` sets `keepMounted: true` and whose `:50-52` renders
`<Activity mode={isExited ? 'hidden' : 'visible'}>`. Argo's `thread-feed-row.tsx:82` passes no
`keepMounted` (grep across the whole dashboard returns nothing), so it inherits that default and F3
does reproduce on collapse→expand in production.

It is **not** true of `@mantine/core` **9.3.0**, which is what `basalt-ui` itself has installed.
There `keepMounted` has no default at all, and the branch is three-valued: `false` unmounts on exit,
`true` renders `Activity`, and **`undefined` falls through to plain children with no `Activity`**.
The default was introduced between 9.3.0 and 9.4.1.

The consequence is concrete and was one command away from being missed: an F3 test that reaches the
`<Activity>` boundary _through Mantine's `Collapse`_ silently would not reproduce the bug inside
basalt-ui. B1's test drives React's `<Activity>` directly. `Activity` is a stable named export of
the installed `react@19.2.7` (`cjs/react.development.js:795`), typed in `@types/react@19.2.17` — not
`unstable_Activity`.

**3. `AGENT-CHAT-SPEC.md` §1's proposed subpath description advertises exports that do not exist.**
It names `ToolChip` (ships 1.10.0) and `ThreadFeedRow` (ships 1.12.0). That string is not decorative
— it feeds `llms.txt`, `AGENTS.md`'s subpath table and the `agents-sync.test.ts` drift gate, so
shipping it verbatim in 1.9.0 would publish a surface listing two exports the tarball does not
contain. B1 ships a description covering only what `src/agent-chat/index.ts` exports today.

**4. The task list does not survive a session.** The orchestration contract treats `TaskList` as
durable state; it is session-scoped. A fresh session opened against a program mid-flight finds it
empty and must rebuild it from the specs. `docs/migrations/hermes-chat-v2.md` plus `git log` are the
only state that actually persists — which is what the contract says, but the task list should not be
relied on across a restart.

### The two harness facts that would have sunk an under-specified brief

Both came out of the research gate, and neither is guessable:

- **The registrator is a separate npm package.** `@happy-dom/global-registrator` (20.11.1), not an
  export of `happy-dom`. And since `@testing-library/react` v16.0.0, `@testing-library/dom` is a
  _peer_, so it installs explicitly too.
- **`@testing-library/react`'s auto-cleanup silently no-ops under `bun test`.** RTL registers it
  with `if (typeof afterEach === 'function')` against the **global** scope; Bun exposes `afterEach`
  only via `import { afterEach } from 'bun:test'`, so the branch never fires and every test leaks
  its DOM into the next (oven-sh/bun#7044). Cleanup is wired by hand in the preload, with a comment
  saying why — otherwise the next reader deletes it as redundant.

Also load-bearing: `[test] preload` runs once per **process**, not per file; `bunfig.toml` is
discovered only in the directory Bun is invoked from, so the root `"test": "bun test"` script is the
only supported entry point; and happy-dom implements neither `ResizeObserver` nor `matchMedia`,
both of which Mantine v9 needs.

### Found while reading `use-agent-thread-runs.ts`, not in any register

Two things worth scheduling rather than silently fixing:

- `consumeAndFinalize` `await`s `resolveOutcome` at `:219` and then writes `setOutcome` / `setStatus`
  at `:221-222` **without re-checking** the supersede/abort guards it checked at `:205-207`. A slow
  async `resolveOutcome` racing a `stop()` looks reachable.
- `stop()` (`:421-431`) unconditionally calls `setStatus(threadId, 'done')` even for a thread that
  was never streaming, while `stopAll()` (`:433-437`) sets no status at all.

Both land naturally in B2, which rewrites `stop()` for stop-preserves-the-partial-turn.

### What the adversarial verifiers caught, and why it generalizes

Eight agents implemented B1 across four disjoint lanes. Every lane reported success. Two verifiers
then found that three of them had shipped code failing a CI gate — and the mechanism was identical
each time: **the lane ran only its own scoped `bun test`, and `bun test` neither typechecks nor
lints nor format-checks.**

- `src/cli/index.ts` — three `TS4111` errors (`pkg.dependencies?.ai` under
  `noPropertyAccessFromIndexSignature`). The lane reported "56 pass, 0 fail" over code `tsc`
  rejects.
- The two new playground demo pages — three `basalt(card-inset)` errors from `<Paper p="md">`. The
  lane verified with `typecheck`, which passed, and never ran oxlint over its own files.
- `README.md` — `oxfmt --check` fails on the widened Requirements table. `git show HEAD:` confirms
  it was clean before the edit.

The lesson is not "the agents were careless" — each verified exactly what it was told to verify. It
is that **a per-lane scoped test is not a gate**, and a parallel fan-out that forbids repo-wide
validation mid-flight (correctly, to avoid racing half-written state) has no gate at all until the
lanes converge. The convergence step is not optional bookkeeping; it is where the only real
validation happens. Budget for a remediation round after any parallel implementation fan-out.

The completeness critic found a second class of problem the correctness verifier could not: the
1.9.0 contract line "the full `src/agent/**` suite" was ~57% delivered. No `thread.test.ts`, no
`ai-sdk-transport.test.ts` — the _other_ module the spec names as one of "the two most intricate in
the package" — and no `parts.test.ts`. All three are current shipped code, testable today, gated on
nothing. "What is missing" and "what is wrong" are different questions and want different agents.

### A live defect, found by writing the tests

`consumeAndFinalize` awaits `resolveOutcome` at `:219` and then writes `setOutcome`/`setStatus` at
`:221-222` without re-checking the supersede/abort guards from `:205-207`. A `stop()` landing during
that await is silently overwritten when the outcome settles. B1 shipped a **verified-failing**
reproduction as a `.skip`'d test in `use-agent-thread-runs.test.tsx`; B2 owns un-skipping it, since
its `stop()` rewrite and its "exactly one writer per terminal path" invariant are what make the
clobber unrepresentable. A dormant test with no scheduled owner rots, so it is filed against B2
explicitly rather than left as a comment.

### happy-dom replaces `TransformStream` with a Node _classic_ stream

The single most consequential thing B1 found, and it is a trap laid directly across B2–B4's path.

`GlobalRegistrator.register()` overwrites `globalThis.TransformStream` and
`globalThis.WritableStream`. Reading happy-dom 20.11.1's `BrowserWindow.ts`: it assigns
`TransformStream = Stream.Transform` and `WritableStream = Stream.Writable` — Node's **classic**
stream classes, not the web-streams API. They share a name and nothing else.

The `ai` package constructs `new TransformStream()` at runtime inside `EventSourceParserStream` and
`DefaultChatTransport.processResponseStream`, so every one of them breaks under the DOM harness with
an opaque error that names neither happy-dom nor the substitution.

The first fix was a per-file monkeypatch in `ai-sdk-transport.test.ts`: swap the native class back at
module-eval time, then `await import('ai')` so `ai` binds the good one. It worked, and it was
**silently order-dependent** — it only held because no other file in the `bun test` graph statically
imports `ai` first. Any future test file that does, and sorts earlier, module-caches `ai` against the
shim and turns the patch into a no-op. B2, B3 and B4 are entirely streaming work and would each have
re-hit this in a different disguise.

The fix belongs in `tests/setup/dom.ts`: restore `ReadableStream` / `TransformStream` /
`WritableStream` from `node:stream/web` immediately after registration. (`ReadableStream` happens to
survive registration today; it is restored anyway, because the reason it survives is not a promise
happy-dom makes.) With that in place the per-file patch was deleted and a plain static import works.

Two lessons, both general: a global DOM shim is not additive — it can replace a global you were
relying on with something of the same name and different semantics; and a workaround whose
correctness depends on module-load order is not a fix, it is a deferred failure with no error
message attached.

### B1 landed — four commits, and master moved underneath it

```
1144284 docs: record the agent-chat framework spec the B-phases build against
9ffa473 feat: prove the agent-chat subpath and the streaming wedge in the playground
006a2a4 feat: open ./agent-chat as its own door, and put the agent layer under test
ea04c6b test: give the repo a DOM harness so the agent layer can be tested at all
```

On `feat/agent-chat-surface`, **not pushed** — basalt-ui is PR-required, and a push opens a PR.

The split is forced by lefthook's `isolated-basalt-ui` hook, and the ordering by what it allows:
the harness commit carries the root files (`bunfig.toml`, `package.json`, `bun.lock`,
`tests/setup/dom.ts`) plus the allowlist widening that lets a future commit stage them beside
`packages/basalt-ui/**` at all; the package commit is the release-triggering one; the playground
and the spec follow because neither may share a commit with the package.

**PR #42 merged mid-flight and someone pulled master while the lanes were running.** The reflog
records `checkout: moving from feat/agent-chat-surface to master` then `pull: Fast-forward` to
`3958a3e`, leaving the branch ref parked on the old `6c568ae` while the uncommitted work sat on top
of the new master. Benign in the end, and arguably better than the alternative: every gate,
including the dist gate, ran against the merged tree, so 1.9.0 is validated on top of the chart
batch rather than against a base that no longer exists. It was worth checking rather than assuming
— three files are touched by both changesets (`CLAUDE.md`, `package.json`, `src/cli/index.ts`), and
a full-file write by any agent would have silently reverted #42's work in them. It didn't:
`docs/STATUS.md`, `basalt-charts.md` and `src/guard/index.ts` are byte-identical to the new master
and the overlapping diffs are purely additive.

The lesson for the rest of this program: a long parallel fan-out cannot assume its base is frozen.
Re-read `git log` before committing, not just before starting — the orchestration contract already
says the git history is the authoritative record, and this is what that means in practice.

### Gate results at commit time

`fmt:check`, `lint`, `typecheck`, `build`, `check-coverage` (all 8 assertions), both generator drift
checks, and the full `bun test` at **1180 pass / 1 skip / 0 fail**, run twice with identical counts.
The dist gate (`pack-test.sh`) passed all 14 steps, including the two that are the actual point:

```
resolved basalt-ui/agent-chat
scratch resolution OK (20 subpaths)
export-surface snapshot OK (19 subpaths)
```

That is the only evidence the new door resolves from the published tarball — the playground
exercises `src/` and never `dist/`.

Two things the full run settled that nothing else could: the happy-dom preload did **not** perturb
the ~48 pre-existing suites (all four `renderToStaticMarkup` files still pass with a real `document`
present), and `lefthook-preset.test.ts` was flaking against Bun's 5000ms default at 5109ms/5004ms —
pre-existing, reproducible with the preload disabled, and fixed by batching its nine `bunx oxfmt`
spawns into one rather than by raising the ceiling.

The one `skip` is deliberate: the `resolveOutcome`-clobbers-`stop()` reproduction, filed against B2.

### Still open on B1

`/review --deep` never ran — the sideclaw MCP server dropped out of the session entirely
(all nine tools gone, not erroring), and reconnecting needs `/mcp` from the client side. The work is
committed rather than held, since uncommitted state is the only thing a compaction cannot recover,
and anything the review finds folds in with `--amend`. The browser gate on the two playground pages
is Johannes's to walk.

### The review — two of them, and each found what the other missed

sideclaw's transport had dropped, so B1's review ran twice in parallel: the sideclaw multi-angle
review and a native Opus subagent pointed at four specific questions. That redundancy was accidental
insurance against an unreliable server, and it paid for itself — neither run found the other's
blocking issue.

**The native reviewer settled the question that mattered most, empirically.** Asked whether the F3
wedge test actually bites, it reverted the one-line `controllersRef.current.clear()`, ran the file,
and restored:

| Wedge case                | With fix | Reverted                                              |
| ------------------------- | -------- | ----------------------------------------------------- |
| genuine unmount + remount | pass     | pass — correct, this is the deliberately-refuted case |
| StrictMode double-invoke  | pass     | FAIL                                                  |
| `<Activity>` hide/show    | pass     | FAIL                                                  |

Run unfixed across all of `src/agent/`: 77 pass, 2 fail, and the two failures are exactly those
cases. So the wedge file is the sole guard, nothing else silently duplicates the claim, and no test
passes both ways while claiming to prove the fix. That last possibility is the one green output
cannot rule out, and it is worth spending a reviewer on.

**sideclaw's adversary angle found that the release's headline claim was false.**
`agent-chat/index.ts` statically re-exports `ThreadTranscript` → `thread-message.tsx` →
`../content/markdown`, whose `import remend from 'remend'` is top-level. Under unbundled ESM,
importing _anything_ from `basalt-ui/agent-chat` evaluates that chain, so **`remend` is a hard
requirement of the new subpath, not an optional peer** — verified by packing and installing with the
Mantine peers but no remend: `Cannot find package 'remend'`. Chasing it down showed `motion` is
hard-required too, for the same reason via `thread-feed.tsx` and `thread-detail-panel.tsx`.

The commit message said the new door "costs none of that", listing the eager remend resolution among
what it sheds. It sheds `BasaltProvider`, the shell, the dashboard composites and `./connectivity` —
not remend. The message was rewritten before the commit was finalized.

Worth naming why this survived every gate: **`pack-test.sh`'s scratch consumer installs every
optional peer at once, so it structurally cannot detect a peer that is secretly required.** The fix
is a second, deliberately minimal install — the same shape as the existing
`charts/tokens-only (no-Mantine)` step, which is the precedent that made the hole visible once
someone looked. A gate that installs everything proves only that everything works.

The other finding worth keeping: restoring the three stream classes to Node's natives **created** a
brand mismatch with `AbortController`/`AbortSignal`, which were left as happy-dom's.
`new <native>ReadableStream(...).pipeTo(ws, { signal })` throws
`TypeError: options.signal must be AbortSignal`. Nothing crosses that seam today only because every
test injects its own `fetch` — but the agent layer's entire contract is abort-based and B2–B4 are
all streaming, so it would have surfaced as an `ai` regression rather than a harness artifact.
Restoring a family of globals by halves is its own bug.

### D3 versus the parity guard — decided, not deferred

`ai-major-parity` shipped as a hard `doctor` failure, and it fails exactly the topology D3 locks in:
`apps/api` on `ai@5`, `apps/dashboard` on `ai@7`, neutralized by a producer-side `TransformStream`.
A guard that permanently fails a correct configuration gets switched off, and then it guards
nothing.

Resolved in basalt-ui 1.9.0 by making the intentional case **declarable**: the consumer's existing
`package.json` `"basalt"` block — the same one `check-theme` reads for `roots` / `exempt` /
`exemptRules` / `severity` — gains one key carrying a **mandatory reason string**. Undeclared skew
still hard-fails, which is what most consumers get. A declared one passes with both the skew and the
reason echoed, so it is acknowledged rather than hidden. A declaration left behind after the skew is
gone warns that it is stale, because a stale exemption is how a real skew slips through later. The
`basalt/ai-sdk-major` lint rule honours the `basalt-agent-allow` line comment its two sibling rules
already use — and deliberately not `theme-allow`.

The reasoning is that the guard's stated purpose was that "nothing pins the pairing". A hard failure
does not pin anything. A required reason, written in the repo where the skew lives, is the pin.

### Phase status

| Phase        | Status  | Note                                                                        |
| ------------ | ------- | --------------------------------------------------------------------------- |
| P0           | done    | Three commits on master, unpushed                                           |
| P1           | done    | Render-only verdict; 25/26 confirmed; both specs corrected                  |
| B1           | wip     | Four lanes running on `feat/agent-chat-surface`, cut from `master`          |
| B2–B4, A1–A6 | pending | Blocked per the dependency graph. A1 and B1 task bodies carry the P1 impact |
