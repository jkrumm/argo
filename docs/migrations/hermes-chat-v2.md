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

`bun run lint` reports 21 warnings across 12 files, none of them touched by P0 — and **exits 0**, so
the gate is green; "fails" was the wrong word here and is corrected in the B1 close-out below. Ruled
out as
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

### The browser gate — walked, and it passed

Both playground pages, driven through Chrome on the mini. The playground root mounts `<StrictMode>`,
so this is the double-invoke path F3 lives on.

`/agent-chat-subpath` renders all four canned messages, including the tool part as a labelled
`CHECK_IMPORT_GRAPH` block with stacked input/output JSON. That is the runtime half of the subpath
proof; `pack-test.sh` is the tarball half.

`/agent-wedge` passed on both paths. Seeding produced the correct pre-reconcile state — thread
`streaming`, reconciler showing the red "wedged — streaming with no active run" — and "Reconcile
now" resolved it to `done` with the resumed assistant text. The more realistic path also works:
seed, then a plain full page reload, and the mount-time sweep resolves it with no click at all.

One honest limit on the evidence: no intermediate "active run — N parts" frame was ever captured,
because resolution beat the polling interval. So what was observed is "it resolves", not "it
resolves through a visible run". The mechanism itself is covered by the unit tests, where reverting
the one-line fix fails exactly the StrictMode and `<Activity>` cases and nothing else.

**A non-finding worth recording so nobody re-chases it.** A console error —
`Can't perform a React state update on a component that hasn't mounted yet`, a two-frame trace
through Vite's dev client and `RouterProvider` — fires once per load on the agent pages. It also
fires on `/` and `/charts`, and on `/agent-chat-subpath`, which has no store, no transport and no
effects at all. Pre-existing global playground scaffolding noise, absent from the published package.
The reason it was worth ten minutes: B1's entire subject is mount-time effects, so a mount-related
warning on its own pages would have meant something. Establishing that a control route shows it too
is what turned it from a suspicion into a closed question.

### The release ladder shifted by one, and B1 nearly published a false version

**1.9.0 released without B1 in it.** The handover predicted that PR #42's chart batch and B1 would
release together, since `semantic-release-monorepo` sweeps every untagged commit touching
`packages/basalt-ui/` since the last tag. Instead 1.9.0 was dispatched from `master` at 14:48 UTC on
2026-08-02 carrying the chart batch alone — five feats, two fixes, three docs — while B1 sat unpushed
on its branch. `npm dist-tags` now reads `latest: 1.9.0`.

So B1 ships as **1.10.0**, and B2/B3/B4 become 1.11.0/1.12.0/1.13.0. That part is not a decision:
semantic-release computes the number from the commit types and B1's package commit is a `feat:`.

What it _was_ is a correctness problem inside the commits. They claimed 1.9.0 in eight places, and
one of those files is shipped to consumers: `agent/rules/basalt-agent.md` is placed into a consumer's
`.claude/rules/` by `basalt-ui sync`, and it said the subpath was "added in 1.9.0" — a real published
version that contains none of it. Merging as-is would have published a documented lie about a
version a consumer can actually install and check. Corrected by amend across two commits, plus the
whole four-minor ladder renumbered in `AGENT-CHAT-SPEC.md` and the tip commit's own message.

This is the same class as the trap caught earlier — the subpath description advertising `ToolChip`
and `ThreadFeedRow` before they exist — and it generalizes: **anything in this program that names a
version is a claim that rots the moment the release train moves, and the release train is not under
this program's control.** Worth grepping for version literals before every future B-phase PR.

The mechanism check that made this safe to act on: `.github/workflows/release.yml` is
`workflow_dispatch` only, so merging does not auto-publish. `make release` stays the deliberate gate,
and its confirmation is a TTY prompt on the computed number — `Publish v<version> to npm? This is
irreversible.` — which is not something to pipe `yes` into.

### Commits rebuilt a second time, and rebased onto the release

The four commits were amended for the version sweep and then rebased onto the new `origin/master`
(`e1f0c8b chore: release 1.9.0`), cleanly, no conflicts. The four-way split imposed by lefthook's
`isolated-basalt-ui` hook survived intact. Doing the rebase before opening the PR rather than letting
GitHub merge it means every gate ran against the tree that will actually land — the same reasoning
that made the accidental mid-flight rebase during implementation turn out to be a good thing.

Rebuilding a middle commit without an interactive rebase, since `-i` is unavailable here: detach at
the target commit, amend it, then `git rebase --onto <new-sha> <old-sha> <branch>` to replay the
rest. Fully non-interactive, no editor, no sequence file.

### Gates, second time around

`fmt:check`, `typecheck`, `check-theme`, `build`, `pack-test` and `bun test` all green.

`lint` needs a footnote: it emits 22 warnings and **exits 0**, so the repo's own gate is green. The
validation worker reported it as a failure on the presence of warning text alone. Checking the exit
code rather than trusting the summary is the difference between a real finding and a wasted
remediation round — the same lesson as the parallel fan-out, from the other direction: a worker's
verdict is a claim, including a worker whose whole job is verdicts.

The other reported failure was real but mine: `bun run build` is not a root script in this repo
(`make build`, or per-package). The command list was wrong, not the tree.

### The PR review — ten findings, three of them wrong

CodeRabbit reviewed PR #43 and left ten inline findings. Each was verified against source by an
independent agent told to try to refute it first. **Three were refuted**, and refuting them was worth
more than applying them would have been:

- **`llms.txt` still says 1.9.0.** True, and correct. The file is generated from `package.json` and
  regenerated after semantic-release bumps the version. Hand-editing it to 1.10.0 would desync it and
  fail the `gen-llms --check` drift gate — a "fix" that breaks CI to correct a string no consumer ever
  sees in a mismatched state.
- **A race in `use-agent-stream.test.tsx:89`.** Not reachable given React's commit granularity. Worse,
  the proposed fix — folding the assertion into `waitFor` — would have _weakened_ the test: as
  written it asserts that `done` is already true at the moment `parts` settles, which is a real claim
  about the hook's single-commit behaviour. The suggestion would have quietly deleted that claim.
- **A missing `await` on `act()`.** The described race is blocked by a synchronous busy guard, and the
  finding's supporting argument — that sibling call sites use awaited `act()` — is simply false; all
  eleven others in that file are synchronous by design.

Of the seven that held, two were worth the whole exercise, and both are in code B1 itself added. The
new `doctor` workspace walk did not exclude `node_modules` (so a `**` pattern descends into
dependency trees and reports installed packages as workspace members) and silently dropped
`!`-negation entries (so a package the consumer explicitly excluded still participates). Either one
makes `ai-major-parity` hard-fail a healthy repo with an exit code the consumer cannot act on — which
is precisely the failure mode that made the guard declarable in the first place, arriving through a
different door. The fix had been reasoned about at the level of "should a correct topology fail?" and
missed at the level of "which directories does the walk actually collect?".

**The verifier also found something the review missed.** Chasing the stale "the chrome ships from the
root entry" sentence in `basalt-agent.md`, it found the identical claim surviving at `README.md:496`
— in a file this branch had otherwise updated for the new subpath, and the more consequential of the
two, because the README quickstart is what a human copies. A reviewer pointed at one instance; asking
"is this claim true anywhere else?" found the other.

`motion` was labelled Major and is not: nothing breaks at runtime, the README was already right, and
every `pack-test` suite installs it. It was guard drift in `required-peers.test.ts` — the file whose
entire job is to hold that fact — whose header contradicted the README of the same commit. Worth
fixing where it sits, not worth the severity.

Standing lesson, now demonstrated twice on this branch from opposite directions: **a review is a
claim, and so is a validation verdict.** The same session had a checker report `lint` as failing when
it exits 0 (it was reacting to warning text), and a reviewer report three defects that do not exist.
Both were resolved the same way — by reading the thing itself rather than the report about it.

### B1 closed — 1.10.0 published, and the round-trip closed a loop

Merged by **rebase**, which is the only method the repo enables and the right one here: it preserves
the four-commit split lefthook forces, keeps history linear, and leaves semantic-release looking at
one isolated `packages/basalt-ui/**` commit. The dry run named the version off exactly that commit —
`v1.9.0 → v1.10.0 (minor)` — and the publish workflow confirmed the registry at 1.10.0.

`make release` has a `YES=1` escape its author built for scripted use. It was used, with the publish
authorized explicitly and the computed number shown first; the major-refusal check runs before that
branch regardless, so the "never a major" guarantee is untouched.

**CodeRabbit never re-reviewed the fixes** — it returned "Review rate limited", so the green check is
the check passing, not a second read. The applied changes carry per-finding verification and the full
gate suite instead. Worth knowing that a green review tick can mean "did not run".

**The round-trip proved the parity guard end to end, which no test inside basalt-ui could.**
Immediately after `bunx basalt-ui sync`, `doctor` hard-failed argo:

```
✖ ai package major version mismatch across workspace packages: @argo/dashboard@ai7, @argo/api@ai5
```

That is D3's topology — the correct configuration — failing a brand-new hard check: exactly the
scenario the declarable exemption was designed for. Declaring `basalt.aiMajorSkewReason` in argo's
`package.json` turned it green with the reason echoed back rather than suppressed. The guard, its
escape hatch, and the consumer it was designed around were only ever exercised together here.

Nine new lint warnings arrived with the upgrade and are expected, not debt: `ai-sdk-major` ×3 (the
lint half of the same guard — it honours a `basalt-agent-allow` line comment, not the package.json
declaration, which is the doctor's escape), `raw-scroll-container` ×4 (newly promoted to `warn`), and
`agent-no-raw-usechat` / `agent-resume-guard` ×1 each, on the chat surface A3 replaces wholesale. The
framework spec predicted this verbatim: "Argo's `chat-conversation.tsx` fails lint until the transport
migration lands. Deliberate — that file is the migration."

**Correction to the P0 entry above:** argo's `bun run lint` does not fail. It reports 30 warnings
(21 pre-existing plus the 9 above), **0 errors, exit 0**, and `check-theme` passes, so the gate is
green. That makes three separate occasions in this program where something reported a failure the
exit code contradicted — a checker on basalt-ui's `lint`, this record's own P0 wording, and a
reviewer's three non-defects. The habit that resolved all three was identical: run the thing and read
`$?` rather than the summary of it.

### Phase status

| Phase        | Status  | Note                                                                            |
| ------------ | ------- | ------------------------------------------------------------------------------- |
| P0           | done    | Three commits on master                                                         |
| P1           | done    | Render-only verdict; 25/26 confirmed; both specs corrected                      |
| B1           | done    | basalt-ui **1.10.0** published; argo consuming it; browser gate + review closed |
| B2           | next    | Unblocked. Ships as 1.11.0. Owns the `.skip`'d resolveOutcome/stop clobber test |
| B3–B4, A1–A6 | pending | Blocked per the dependency graph. A1 and B1 task bodies carry the P1 impact     |

---

## B2 — basalt-ui 1.11.0

### The lanes were not disjoint, and the handover said they were

The mid-B2 handover hands the next orchestrator three "genuinely disjoint" lanes and recommends
running them as parallel implementers. Two of them collide:

| Collision                                   | Lanes                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `use-agent-thread-runs.ts`                  | 1 (push → `mergePart`, resume gate) **and** 3 (stop, `finish`, clobber) |
| `src/agent/index.ts` — the `./agent` barrel | 1, 2 **and** 3                                                          |

A running implementer exclusively owns the files it touches, so lanes 1 and 3 in parallel is the
named failure mode, not a shortcut. Resequenced to lane 2 ‖ lane 1 (genuinely disjoint), then lane 3
once lane 1 releases the hook file. The barrel was assigned outright to lane 2 — the lane with the
most new public surface — and lane 1 was told to export from its own module and leave the barrel
alone, against an orchestrator convergence pass of two lines. Cheaper than two agents racing an
append-only file.

Four line numbers in the handover had drifted, all in ways that would have sent a worker to the wrong
place: `part-list.tsx` is in `src/agent/`, not `src/agent-chat/`; the resume gate is `:343-350`, not
`:337-341`; `stop()` is `:427-437`, not `~:421-431`; the `.skip`'d test is at `:356` with its
rationale comment at `:348-355`, not `~:317`. The handover is a snapshot and says so. Re-reading the
tree before briefing is not optional.

### The six v7 corrections confirmed, and three new bugs found under them

Re-read from installed source (`ai@7.0.16`) to write lane 1's brief. All six corrections in the
handover held verbatim. Two additions that materially change the transport's design:

**`input` is required on the message PART at `output-available`** (`.d.ts:2030`, no `?`). The
handover's correction 5 — "the wire carries only `output`" — is true of the _chunk_ and does not
apply here, because `aiSdkTransport` diffs `message.parts` snapshots and the SDK has already
re-supplied `input` from the stored invocation (`index.js:6936-6958`). The transport does not need to
carry input forward. Worth knowing anyway: `updateToolPart` (`index.js:6525-6555`) blind-_overwrites_
input rather than merging, so an omitted input is destroyed, not preserved.

**The SDK root-exports `getToolName`, `getStaticToolName`, `isToolUIPart`, `ToolUIPart` and
`DynamicToolUIPart`** — and they must not be imported. `ai-sdk-transport.ts:56` imports from `ai`
type-only by deliberate design; the file never resolves the peer at runtime (that is what
`createAiSdkResolver` exists for). Taking the convenient value import would hard-require `ai` at
runtime for every consumer. Use the types, reimplement the two-line name derivation.

Three defects surfaced that appear in no spec, no register and no handover:

| #   | Defect                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | **Dynamic tool names are destroyed.** `curr.type.slice('tool-'.length)` runs on every tool part, but `DynamicToolUIPart` has `type: 'dynamic-tool'` and carries its name only in `part.toolName`. Every dynamic tool renders as the literal string `dynamic-tool`                                                             |
| b   | **`if (prev?.state === curr.state) return []` drops preliminary refinements.** `preliminary: true` outputs stream — successive updates arrive with `state: 'output-available'` unchanged and `output` mutating. The early return emits the first and discards the rest, so a streaming tool result freezes at its first chunk |
| c   | **`output-denied` carries neither `output` nor `errorText`.** Consumer logic shaped "error if `errorText`, else done if `output`, else pending" renders a denied tool as pending forever                                                                                                                                      |

(b) is the interesting one: it is invisible to any test that drives one state transition per tool
call, which is what every fixture in the repo does today.

Also confirmed, and it settles a question that keeps getting re-litigated: `reconnectToStream`
(`.d.ts:5409-5412`) takes no `AbortSignal` — deliberately asymmetric with `sendMessages`, which has
one at `:5388` — and its runtime is a bare `GET` with no signal, no offset and no `Last-Event-ID`
(`index.js:16297-16304`). "Do not fix the resume offset" is now read out of the SDK rather than
inferred from a grep count.

And the reverse-lookup constraint has teeth: `tool-approval-response` carries `approvalId`,
`approved` and `reason?` but **no `toolCallId`** (`.d.ts:2462-2467`), and the SDK resolves it by
scanning accumulated parts for a matching `approval.id`, _throwing_ when the request chunk was never
applied (`index.js:6508-6523`). The mapping exists only in accumulated state, never on the wire — so
a transport that drops or reorders the request chunk makes the response unrecoverable. `coalesce.ts`
already carries the side index for this.

### Lane 3's scope is three bugs, not one

Reading `use-agent-thread-runs.ts` for the lane-3 brief turned the handover's one-line "stop()/stopAll()
status asymmetry" into three distinct defects:

- **`stop()` writes `setStatus(threadId, 'done')` unconditionally** (`:430`), with no check that the
  thread ever streamed. `stop()` on an idle thread writes `'done'` and bumps `updatedAt`. Its own
  JSDoc at `:109` claims "no-op if idle", which is false.
- **`stopAll()` touches `storeRef` zero times** (`:439-443`) — no `setStatus`, no `setOutcome`,
  nothing. Threads it aborts keep `'streaming'` forever, and because the abort makes
  `consumeAndFinalize` bail early, nothing ever resolves them.
- **The `.skip`'d test at `:356` pins a third:** `consumeAndFinalize` awaits `resolveOutcome` at
  `:219`, then writes `setOutcome`/`setStatus` at `:221-222` **without re-checking** the
  supersede/abort guards it checked at `:205-207` immediately before the await. A slow
  `resolveOutcome` racing a `stop()` silently overwrites `'done'`. The test was verified failing
  before being skipped — it is a genuine pinned defect, not dead weight.

Constraints that bound the fix: `ThreadsStore` has no message-patch mutator at all — `appendMessage`
is the only message-level write (`thread.ts:128`) — `ChatMessage` has no `finish` field
(`history.ts:41-46`), and `AgentOutcome['status']` is `'done' | 'attention' | 'error'` with no
`'stopped'`. Per spec §10 `ThreadStatus` is deliberately **not** widened with `'stopped'`; the
message-level `finish` carries that distinction instead.

### Both lanes landed green, and their convergence was still broken

Lane 1 (transport + hooks) and Lane 2 (registry + chrome) each reported all five gates at exit 0, and
Lane 2's `bun test` ran after both had landed — 1290 pass, 1 skip, 0 fail over the merged tree. The
merged tree was nevertheless wrong in a way neither lane could see, and no test caught it:

- Lane 1 needed `mergePart`'s `<TPart extends AgentPart>` bound, so it constrained the hooks:
  `useAgentStream<TPart extends AgentPart>`, `useAgentThreadRuns<TPart extends AgentPart>`.
- Lane 2 introduced `TranscriptPart = AgentPart | ForeignPart`, and `ForeignPart.type` is `string`.

No `AgentPart` variant accepts a widened `string` discriminator, so `TranscriptPart` does not extend
`AgentPart` and `useAgentThreadRuns<TranscriptPart>` does not compile. The registry's whole purpose is
that a part basalt does not know reaches the transcript — and spec §4's own example is a
server-emitted `data-toolProgress`, which has to travel transport → hook accumulator →
`runs.get(id).parts` → `liveParts`. `PartRenderContext.settled` ("false while this part belongs to
the in-flight tail of a streaming turn") is only meaningful if foreign parts pass through the
streaming hook. Shipped as-was, 1.11.0 would have advertised a registry that could not carry the
parts it exists for.

The fix relaxes the constraint chain to a structural bound (`{ id: string; type: string }` — all
`mergePart` actually reads) rather than closing the union. Folding `ForeignPart` into `AgentPart`
remains forbidden: it would make `assertNever` accept everything. Widening a generic constraint is
backward compatible, so this stays a minor.

The general lesson is the one the B1 record already stated in a different form: **a per-lane scoped
gate is not a gate.** Here both lanes ran the _full_ suite and both were honestly green, because the
defect lives in a combination no test constructs. Parallel fan-out needs a convergence pass that
tests the seam between the lanes, not just the union of their diffs.

### Two corrections that came from the workers, not the orchestrator

**A worker refuted the spec, correctly.** `AGENT-CHAT-SPEC.md` claimed in three places that a stale
key in an augmented `definePartRenderers` map is a tsc error. Lane 2 built a minimal `tsc` repro and
showed it is not: `<const T extends Constraint>` inference does not excess-property-check an
object-literal argument, so only _missing_ keys are caught, and that comes from ordinary
assignability rather than freshness. An `@ts-expect-error` asserting the stale-key error is itself an
unused-directive error — which is how it surfaced. Rather than reach for an `Exact<T, Shape>` wrapper,
the claim was deleted: the Canonical token-factory contract mandates one shape across every `defineX`,
a stale key is dead code that never fires, and the valuable half is still caught. All three spec
sites corrected.

**Lane 1 found that bug (a) was worse than the brief said.** The brief described dynamic tool calls as
_mislabeled_ — rendering as the literal string `dynamic-tool`. In fact `diffPart`'s default branch
tested `currPart.type.startsWith('tool-')`, which is `false` for `type: 'dynamic-tool'`, so dynamic
tool calls were **dropped entirely**, never reaching the transcript at all. The orchestrator's brief
undersold a defect it had itself discovered; the worker corrected it while implementing. Briefing
workers to push back, and meaning it, has now paid three times in this program.

The convergence pass reproduced it before fixing it, which was the point of asking for a repro rather
than a fix:

```
error TS2344: Type 'TranscriptPart' does not satisfy the constraint 'AgentPart'.
  Type 'ForeignPart' is not assignable to type 'AgentPart'.
```

The fix introduces a structural `PartLike = { id: string; type: string }` — everything `mergePart`
actually reads — and relaxes `mergePart`, `useAgentStream`, `useAgentThreadRuns` and
`consumeAndFinalize` onto it. `isTextLikeType`'s parameter widens to `string`; it is already a type
predicate narrowing to the two text-like literals, so a `ForeignPart` always falls through to the
wholesale-replace path and `AgentPart` splicing is unchanged. `PartList` and `coalesceParts` keep
`extends AgentPart` — they only ever handle the closed union. Default type arguments were not touched,
so the change is a pure constraint widening: backward compatible, and a minor.

The regression test for it is worth describing precisely, because "would it have failed before?" has a
stronger answer than usual here: the test instantiates `useAgentThreadRuns<TranscriptPart>`, so before
the fix it would not have compiled at all. Not a failed assertion — a `tsc` error in the test file.
Gates after convergence: six of six at exit 0, 1295 pass / 1 skip / 0 fail, the one skip being the
deliberately pinned `stop()`-clobber test that lane 3 owns.

### The playground gate found the API gap it exists to find

Three of the four 1.11.0 gate demos landed clean. The fourth — the render-count HUD — could not be
built as specified, and the way it failed is the useful part.

`thread-message.tsx` exports `messageBlockRenderCounter` precisely so the one-re-render-per-delta
budget can be asserted. It is reachable from **no public surface**: not re-exported from
`agent-chat/index.ts`, and no `package.json` `exports` subpath resolves it. The worker verified this
with a probe rather than assuming —

```
error TS2307: Cannot find module 'basalt-ui/agent-chat/thread-message'
```

— then declined to reach into `packages/basalt-ui/src` with a relative import, on the grounds that a
consumer of the published package cannot do that, so a demo which did would prove nothing. It built a
`MutationObserver` proxy over `ThreadTranscript`'s rendered DOM instead, bucketing mutations by
message block, and reported the number it actually observed (**1**, held across a full ~19-delta run)
together with the caveat that this is a one-directional proxy — a component that truly bails out of
`memo()` emits zero DOM mutations, so the signal is valid but is not the framework's own counter.

**Decision: do not export the counter.** A mutable test-only counter is not something to freeze into
an NPM package's public API on a release that also forbids a major, and the authoritative measurement
already exists in `thread-message.test.tsx`, where the budget asserts exactly 1. The playground's job
at this gate is human-observable evidence, which the DOM proxy supplies. The gate item is recorded as
met by two complementary measurements rather than by the one it originally named.

The generalizable point: the gate is worth running precisely because it is the first time the release's
API is exercised from **outside** the package boundary. Both the missing surface and the honest
"here is a proxy and here is why it is not the real number" came from that vantage, and neither would
have surfaced from inside the framework's own test suite — which was, of course, green throughout.

### A guard that was right for four minors and enforced for none

`mantine-shade-index` was introduced in 1.7.0 as `warn` under the grace-minor doctrine — one minor of
warning, then promotion to error. It was deferred by 1.8.0 (which shipped the same day as 1.7.0), by
1.9.0 (which carried the chart-layer batch the same consumer was waiting on), and then 1.10.0 shipped
without the promotion at all, leaving a `GRACE_PERIOD_KINDS` entry that read "promote to error in
1.10.0" _after_ 1.10.0 had shipped.

Promoted in 1.11.0 rather than deferred a fourth time, and the check that made it a five-minute
decision instead of a debate: run the guard against the only consumer first. Argo's `check-theme`
reports zero violations of any kind, so the promotion cannot break anything that was passing.
`GRACE_PERIOD_KINDS` is empty again, which is the state it should spend most of its life in.

### `finish` was persisted and rendered by nothing

The fourth gate demo — stop mid-stream, partial text survives, labelled stopped — surfaced the same
class of gap as the third, one level up. `stop()` now persists an assistant message carrying
`finish: 'stopped'`, and `ThreadTranscript` / `MessageBlock` **never read that field**. A stopped turn
renders identically to a completed one, and the demo could only show the distinction by building a
"message ledger" panel of its own beside the transcript.

Two reasons that is a defect rather than a missing nicety:

1. The 1.11.0 gate item is _"leaves the partial text in the transcript, **labelled stopped**"_. The
   framework satisfied the first half and could not satisfy the second.
2. Spec §10's argument for **not** widening `ThreadStatus` with a `'stopped'` member is, verbatim,
   "for a distinction the message-level `finish` already carries." If nothing reads `finish`, the
   distinction is carried and never shown, and the argument that justified the narrower type is
   hollow.

Closed inside B2 rather than deferred to B4's affordance work: it is small, additive, and it is the
other half of a lifecycle feature already shipping in this release. Shipping `finish` with no reader
would mean 1.11.0's headline lifecycle change is invisible to any consumer who does not build their
own chrome. `'complete'` deliberately renders nothing — labelling the ordinary case would put a badge
on every message in the transcript.

Worth noting how it was found. The demo author traced the code path statically and said so explicitly:
"this is a static trace of the exact code path the demo drives, not an empirical browser observation —
flagging that distinction explicitly since it matters for the gate." That is the same discipline that
separates "I could not reproduce it" from "it cannot happen", and it is the reason the browser gate in
the phase loop is a separate step from the test gate rather than a restatement of it.

### B2 closed — 1.11.0 published, and two gates that only fire outside the repo

`basalt-ui@1.11.0` is on npm; six commits rebase-merged to `master`; argo consumes it. The
round-trip was clean, which contradicted the prediction written here an hour earlier — argo imports
**zero** from `./agent` and `./agent-chat`, so a release that is genuinely semver-breaking on those
subpaths lands on the consumer without a scratch. The breakage is real and deferred, not absent; A3
is where it gets paid.

Two gates fired that no amount of local discipline would have caught, and both are worth carrying
forward:

**The repo's own gate is `bun run pre`, not a hand-assembled list.** Five commands were run
individually and reported as "six gates green"; `check-theme` was not among them. lefthook rejected
the very first commit — a `raw-surface` violation on `ToolChip`'s state dot — in the same commit that
was _promoting a guard out of its grace period_. Resolved with a documented `theme-allow` matching the
`ChartLegend`/`ChartTooltip` precedent for sub-scale corners. The lesson is not "run check-theme"; it
is that a paraphrase of a repo's gate is not the gate.

**CI carries an export-surface snapshot that runs in none of the local gates.** `pack-test.sh` installs
the packed tarball into a scratch consumer and diffs `Object.keys()` per subpath against a committed
snapshot, because publint and attw validate the export _map_ and not named-export completeness — a
barrel that silently drops an export passes both and hard-fails the consumer's build. Ten new exports
were unsnapshotted. Regenerating it locally needed `--base` pointed at the built package, and the
generator's formatting then lost to oxfmt, which owns that JSON. Verified the diff semantically —
zero exports removed, exactly the ten CI named — rather than trusting a 33-insertion diff by eye.

**CodeRabbit returned "Review rate limited" and showed a green check.** Third occurrence in this
program of a green signal that means "did not run". It was not counted as a review; the PR's actual
review coverage was two sideclaw angle-router passes and an adversarial Opus pass, which between them
found six defects in code that passed every gate.

Both follow-up fixes were folded into the commits that introduced them via the documented
detach-and-`rebase --onto` technique, since `rebase -i` is unavailable here and the repo forbids
single-line fix commits. `basalt-ui` is rebase-merge only, so those commits land on `master`
individually and their accuracy is not cosmetic.

Final state: `bun run pre` = 0, `bun test` = 1322 pass / 0 fail / 0 skip, `make build` = 0,
export-surface = 0, argo's dashboard typecheck + api typecheck + format + build all 0.

## B3 — basalt-ui 1.12.0

### The handover's lane split did not survive contact with the tree

B2's closing lesson was "verify disjointness against the tree before parallelising". Doing that
first is what B3 started with, and it immediately contradicted the plan. The scope reads as five
independent seams — markdown fences, the settle fix, composer slots, the threads adapter, the
carried defects — but a file-level map showed `markdown-fences` and `settle-fix` both rewriting
`MarkdownProps` at `markdown.tsx:60-85` and both editing `TextRenderer` at `thread-message.tsx:68-77`.
The same hunks, in two lanes. Split as written they would have merged broken, which is exactly the
B2 failure mode that produced this lesson in the first place.

They ran as one lane. Four contended artifacts — `scripts/export-surface.json`, `src/surfaces.ts`
(plus the generated `llms.txt` and drift-gated `AGENTS.md`), the root `src/index.ts`, and
`packages/basalt-ui/tsconfig.json` — were assigned to **no** lane and held for a convergence pass.

One scope change followed from that. Enabling test typechecking (the `src/**/*.test.ts(x)` exclude)
was in the carried-defects lane's brief until it became obvious the enable would surface a backlog
across test files _other lanes were mid-write on_, which the owning lane could not fix. It moved to
convergence, after every lane has landed.

### The checkout's install was stale, and bun's linker is isolated here

`bun install` reported "Checked 1541 installs across 1819 packages" while the repo-root
`node_modules` held 12 entries. Not a broken install — this repo uses bun's **isolated** linker, so
`remend`, `react-markdown` and `shiki` resolve from `packages/basalt-ui/node_modules` and
`apps/playground/node_modules`, never hoisted to the root. A worker probing for them at the root
concludes they are absent and starts fixing the wrong problem.

### The research pass found the defect that would have shipped a disabled sanitizer

`hast-util-sanitize` merges a supplied schema with a **shallow top-level spread only** — its source
is literally `schema: options ? {...defaultSchema, ...options} : defaultSchema`. So passing an
`attributes` object **replaces** `defaultSchema.attributes` entirely. A consumer adding one attribute
allowance to one tag silently destroys every default allowance; `tagNames` do not concatenate either.
There is no official deep-merge helper in either package — the upstream docs tell you to add the
third-party `deepmerge`.

basalt has zero runtime dependencies and is not acquiring one for this, so it owns a small additive
merge for exactly this schema shape. The requirement that makes it testable: **the test suite has to
fail against a naive shallow spread**, or it proves nothing.

This is also a second, independent argument for the spec's locked "data extension, not a
`(base) => Schema` callback" decision. The recorded rationale was that a callback can return `{}` and
silently disable sanitization. The stronger one is that the _data_ form is the only shape basalt can
deep-merge additively on the consumer's behalf — with a callback, the consumer performs the merge,
and the upstream shallow-spread trap becomes theirs to fall into.

Facts pinned for the lane, from package source rather than memory: `rehype-sanitize` 6.0.0 and
`hast-util-sanitize` 5.0.2, both ESM-only; `defaultSchema` is re-exported by `rehype-sanitize` itself
so only the one optional peer is needed; unified runs plugins in registration order, and
rehype-sanitize's own Security section states "everything after rehype-sanitize could be unsafe" —
which is the enforcement mechanism behind appending basalt's pass last.

### Two spec claims overridden, deliberately

**`BASALT_SANITIZE_SCHEMA` cannot be the fully-materialized baseline the spec describes.**
`defaultSchema` lives in an _optional_ peer, so materializing it at module scope requires a static
import of that peer — hard-requiring it for every consumer. That is precisely the F2 bug this same
release fixes for `remend`; reintroducing it for the sanitizer would be self-defeating. The
alternative, vendoring GitHub's schema into basalt, drifts silently on a security baseline. So it is
the **additions layer**, and the effective schema is composed lazily where the peer is already
dynamically imported.

**`spliceText` clamps rather than throws.** Both reviewers who found it proposed bounds-check-and-
throw. This is stream-reduction code on the render path, and a throw converts a transient wire
anomaly into a permanently dead transcript. It clamps, warns in dev, and the JSDoc narrows to the two
shapes actually supported.

### The adversarial pass found what three green test suites did not

All three lanes in the first fan-out reported green — 18, 31 and 101 passing tests, `tsc` clean,
oxlint clean. The adversarial verifiers then found 13 defects across them, three blocking.

The most instructive is the composer's. Spec section 8's _first_ behavioural promise is "draft state
clears only on a successful submit, so a failed send does not eat what was typed". The test covering
it read `input().value` from inside the `onSubmit` callback — but React does not flush a
`useSyncExternalStore`-driven re-render mid-event-handler, it batches to the end of the discrete
event. The DOM shows the old value whether the clear runs before or after the callback. The verifier
proved it by moving the clear _before_ `onSubmit` and watching the test stay green. The headline
acceptance criterion of the phase was, in effect, untested.

Two more in the same class. The adapter's `draftKey`-equivalent hydration path — `readPersistedValue`
— was never executed by any of the 18 tests, because a module-scope store cache outlives unmount and
satisfies every persistence assertion; a wrong storage-key prefix on the read side would have left
the suite green while every real page-reload draft vanished. And an adapter test asserting that
unmount aborts an in-flight load could not fail at all: after unmount, `result.current` is frozen at
the last committed render, and the field it asserted on was already `undefined` before the abort.

The generalization: **a test written against the same mental model as the implementation inherits its
blind spot.** All three survived a competent author, a passing run and a type check. What caught them
was a reader whose explicit job was to make them fail. Worth carrying into every later phase — the
question to ask of a new test is not "does it pass" but "would it fail if the behaviour it names were
absent", and the cheap way to answer is to break the implementation and watch.

### The two blocking adapter defects are the seam argo will actually hit

Both are the same class: correct for one write in flight, wrong for the concurrent case, which is the
normal case.

`createAdapterThreadsStore` fired every adapter write immediately with no per-thread ordering. The
real consumer path issues four writes in one synchronous tick — `thread-workspace.tsx:106-111` calls
`create()` then `markRead()`, and `use-agent-thread-runs.ts:508-509` then appends the user message and
sets status. Against a server-backed adapter the three dependent writes arrive before `createThread`
has resolved, are rejected, and the store rolls the user's message back out of the transcript. Argo's
adapter is Postgres-backed, so this is not hypothetical; it is A3's first bug, found before A3.

The second: a superseded `revalidate()` returned early without refreshing `base`, but `mutate()`
dropped its optimistic patch regardless — so a _confirmed_ write's effect vanished for the duration of
the surviving round-trip. On create-and-send that collapses the entire new thread out of the list. The
module's own docs claimed the opposite guarantee.

### A ruling applied to one function and not its sibling

The carried-defects lane was told, in writing, that `spliceText` must clamp rather than throw because
a throw on the render path kills the transcript. In the same diff it gave `coalesceParts` a
`default: return assertNever(next)` — a runtime throw, on the same render path, in a public function
that folds wire data. It was not mentioned in the lane's concerns.

The resolution keeps both properties rather than trading one away: the default branch still binds the
value at type `never`, so `tsc` fails if a future state joins the union and exhaustiveness is
preserved as decision D2 requires — but at runtime it returns a safe fallback and warns in dev instead
of throwing. Exhaustive at build time, defensive at run time.

The lane also justified normalizing `toolCallId: ''` with a claim that the shape "existed on the wire,
basalt's own pre-1.12.0 mapping emitted it". The verifier ran `git log -S` and disproved it: the only
commit containing that literal puts every occurrence in test fixtures, and the sole shipped mapping
reads the SDK's required non-empty field. The change was also silently converting a previously-parsing
part into a _dropped_ one on six states — data loss in a transcript, worse than the sentinel it
replaced. The modelling change stands on its actual merit; the justification and the drop behaviour do not.

### The fix for F1 removed a security control, and only an executed probe caught it

The highest-value defect in B3 was introduced by B3's own headline fix.

`Markdown` overloads its `streaming` prop to do two unrelated jobs: pick the streaming-vs-settled
render path, **and** pick the image allowlist —
`allowedImagePrefixes = streaming ? ['/'] : ['https://', '/']`. The comment above it says why in as
many words: streamed model-generated markdown auto-fetches images, so an open `https://` default is
a prompt-injection exfiltration channel.

`TextRenderer` used to hardcode `streaming`, so every agent message got the restrictive same-origin
list — the security property held by accident, as a side effect of the bug F1 exists to fix.
Threading real settledness through it, which is exactly what F1 requires, flipped every _finished_
message to the permissive list. That is most of a transcript. The fix and the regression are the
same line of code.

The lesson is narrower and more useful than "be careful": **a boolean that drives two unrelated
decisions will eventually be changed for one of them.** The prop was overloaded before this phase;
F1 merely made the second meaning reachable. Settledness is about rendering, trust is about
provenance, and model-generated content is untrusted whether or not the run has finished.

Three more in the same fan-out, all found by _executing_ against the real installed packages rather
than reading them:

**The additions-only sanitize extension could express three different removals.** An empty
`clobberPrefix` disables DOM-clobbering protection entirely, because `hast-util-sanitize` gates
prefixing on truthiness — `{"id":"user-content-body"}` becomes `{"id":"body"}`, which is the exact
vector the prefix exists to stop. A tag-specific attribute addition _deletes_ what the base granted
that tag via the `'*'` fallback, because upstream consults the wildcard only when the tag-specific
lookup returns null/undefined, and an array-valued property returns `[]` instead. And widening an
already-allowed property is a silent no-op, because `findDefinition` returns on the first entry
matching the property name and the merge put base entries first — so every later entry for that
property is dead code.

All three are the same root mistake: the merge was written against the _shape_ of the schema without
modelling how the consumer actually _reads_ it. A schema merge is only additive with respect to a
particular lookup algorithm.

**The fence registry indexed a plain object with a model-controlled key.** The fence language comes
off the `language-*` class, `defaultSchema` permits any such class, and `renderers?.[language] ?? BUILT_IN[language]`
never falls through for a key that exists on `Object.prototype` — so a fence opened with the language
`valueOf` throws during render.

**The always-on sanitize pass broke every GFM footnote link.** `mdast-util-to-hast` already applies
`user-content-` to both the id and the href; `hast-util-sanitize` then prefixes ids a second time and
hrefs not at all, so every footnote anchor dangles. Neither package is wrong on its own — the bug
only exists in their composition, which is the kind of defect no single-package test suite can hold.

### Mutation testing became the standard, and it immediately paid

After the first adversarial round found three tests that could not fail, every fix brief carried the
same requirement: break the implementation in the specific way the test names, watch it fail, restore
it, and report the pass/fail counts at each step.

The composer lane's evidence is the model. It rewrote the clear-on-success test to probe
`localStorage` — which the store writes synchronously — instead of `input().value`, then moved the
clear above the `onSubmit` call and observed 20 pass / 1 fail. It then went further and appended a
scratch test carrying the OLD `input().value` probe, re-applied the same mutation, and watched the
old probe pass while the new one failed **in the same run**. That is not a claim that the test is
better; it is a demonstration.

The cost is small and the alternative is what this phase already saw twice: a competent author, a
passing suite, a clean typecheck, and an untested acceptance criterion. Worth making the default for
A1's idempotency work, where the invariants are the deliverable and a green suite proves the least.

### Spec section 8 promised something the signature could not deliver

The composer's `onSubmit` returns `void`, so Composer cannot observe an async failure — by the time a
network error arrives, the draft is already cleared. The spec's promise ("a failed send does not eat
what was typed") therefore held only for a _synchronous throw_, which is not the case that happens in
production. The lane found this itself and documented it rather than fixing it, on the correct
grounds that fixing it changes a public signature.

Taking it now rather than later: B3 is the release that _sets_ Composer's contract, and the gate
recorded for "after B4, before A3" exists precisely because the framework API is fixed at that point
and getting it wrong costs a major, which is forbidden. A signature widened in 1.12.0 is free; the
same widening after 1.13.0 is not.

The shape matters as much as the decision. Naively awaiting the promise before clearing would leave
the typed text in the box for the whole round trip — wrong for a chat composer, where the input is
expected to clear the instant you hit send. So: `void | Promise<void>` (source-compatible, an
existing void handler still assignable), clear optimistically, and **restore on rejection** — with
"do not destroy user input" beating "restore at all costs" wherever the two conflict, since the user
may have typed something new in the meantime.

### B3 convergence checklist — LIVE, delete this section when B3 closes

Nothing below is committed yet. Held for the convergence pass because these files are owned by no
lane, or because the work spans files several lanes were mid-write on.

**Barrels.** `src/content/index.ts` needs `SanitizeSchemaInput` (now the parameter type of the public
`mergeSanitizeSchema`, so consumers cannot otherwise name it) and `MarkdownContentTrust`.
`src/agent/index.ts` needs `createAdapterThreadsStore` + `threadsStoreAdapterContract` (values) and
`ThreadsStoreAdapter`, `AdapterThreadsStoreOptions`, `ThreadsStoreAdapterContractCase` (types). Root
`src/index.ts` needs the agent values plus `ComposerSubmit`/`ComposerAttachment`.
`src/agent-chat/index.ts` is already complete.

**Export surface.** Regenerate AFTER `make build` — the script imports the built `dist`. Only VALUE
exports appear; type-only exports are erased by `Object.keys()` and adding them by hand fails the
gate. Then `bunx oxfmt --write` on the JSON, which oxfmt owns and the generator formats differently.

**`surfaces.ts` + generated `llms.txt` + drift-gated `AGENTS.md`.** One correction is mandatory, not
cosmetic: all three currently describe `streaming` as the thing that restricts images. That is now
false. `streaming` is a rendering mode; `contentTrust` is the security input; any surface rendering
model output must pin `contentTrust="untrusted"`.

**Test typechecking.** Remove the `src/**/*.test.ts(x)` excludes from
`packages/basalt-ui/tsconfig.json` and clear the backlog. Deferred from every lane on purpose — the
backlog spans files other lanes owned, so no single lane could have fixed it.

**`tests/setup/dom.ts`.** Move the `document.fonts` shim there, next to the existing ResizeObserver
and matchMedia shims. happy-dom ships no `document.fonts`, and Mantine v9's Textarea autosize calls
`document.fonts.addEventListener` on mount, so every test rendering an autosize `Textarea` throws. It
is currently shimmed locally at the top of one test file; the next lane to render a Textarea will
otherwise hit the same wall and reinvent it.

**CHANGELOG (1.12.0) — these go in the COMMIT BODIES, not in a file.**
`packages/basalt-ui/CHANGELOG.md` is generated by `@semantic-release/changelog` from the commit
messages, and is a release asset committed by `@semantic-release/git`. Hand-editing it would be
overwritten at release. Three behaviour changes are not additive and must be written into the
commits that introduce them:

1. `contentTrust` is new, and `streaming` no longer governs the image allowlist.
2. `Markdown`'s `a` override now forwards the sanitized attributes it previously dropped, so
   footnote refs, `data-footnote-*`, `class` and `aria-*` reach the DOM. Visible change.
3. The composed sanitize schema sets `clobberPrefix: ''`, and any consumer passing `rehypePlugins`
   now has that output sanitized.

**The `clobberPrefix: ''` trade, recorded because it looks contradictory.** basalt disables
`hast-util-sanitize`'s id/name namespacing while simultaneously refusing to let a consumer disable
it. That is coherent, and the reason should not have to be re-derived: `mdast-util-to-hast` has
_already_ applied `user-content-` to both the id and the href before sanitize runs, so sanitize's
layer is a redundant second pass that prefixes ids and not hrefs — which is precisely what broke every
footnote link. Disabling the redundant layer restores the round trip; a consumer disabling it removes
the only layer covering content they inject.

The residue, verified by execution rather than assumed: a consumer who adds `rehype-raw` gets
un-namespaced ids on injected elements. It does not bite basalt itself, because basalt parses no raw
HTML — raw HTML with an id or name is dropped entirely, and footnote ids stay namespaced even with an
attacker-chosen identifier. Both facts were executed, not reasoned. The alternative candidate
(clearing remark-rehype's prefix instead) was built and measured too: it yields `href="#fn-1"` beside
`id="user-content-fn-1"`, still dangling. Chosen on evidence.

### A green test was pinning a false claim

The F2 fix — making `remend` a lazy import so the root entry stops hard-requiring an optional peer —
exposed a failure mode worth naming, because a gate cannot catch it by construction.

`tests/required-peers.test.ts` asserts that `surfaces.ts`'s description mentions `remend` together
with `required`. That test's intent is good: keep the hand-maintained surface docs honest about peer
requirements. But once `remend` went lazy, the claim it was pinning became false — and the test
stayed **green**, because `surfaces.ts` still carried the stale wording. Worse, `surfaces.ts`
contradicted itself twenty lines apart: `remend` described as "required, not optional … imported
eagerly" at one line, and "now a lazy optional peer" at another.

Correcting the file alone would have turned a passing test red for entirely the right reason, which
is the trap: the obvious reading of that failure is "my change broke a test", and the obvious fix is
to revert. The two have to move together, and knowing that requires understanding what the test was
_for_ rather than what it _checks_.

A test that asserts documentation matches reality inverts the usual direction of trust — it fails
when the docs drift, but it also silently enshrines whatever the docs said on the day it was written.
When the underlying fact changes, the test becomes an active defender of the wrong answer.

The related pattern, one layer up: the same file carried a deliberate tripwire asserting the static
`remend` import _still existed_, with a comment instructing its own deletion in this phase. Firing
correctly is what it was for. But "delete me" was the wrong instruction — a static import is trivially
reintroduced by someone debugging, and the consequence is a root entry that hard-requires an optional
peer again. It was inverted into a regression guard over all of `src/**` instead, precise enough to
exclude the lazy `import('remend')` call and type-only imports while still catching a static
re-export. A tripwire is worth more after it fires, not less.

### Enabling test typechecking cost 97 errors and found two traps worth more than the errors

`packages/basalt-ui/tsconfig.json` excluded `src/**/*.test.ts(x)`, so a green `typecheck` said nothing
whatsoever about test code. Removing the excludes surfaced 97 errors. Ninety-six were in test files
and were fixed; the ninety-seventh was a one-line consequence in `src/cli/index.ts` (an
`@ts-expect-error` that no longer suppressed anything once Bun's globals entered the program).

The backlog itself was mostly mechanical — missing `id` on mock-transport yields now that
`AgentPart` requires one, test doubles missing `ThreadsStore`'s new `hydrated`/`error`,
`noUncheckedIndexedAccess` on fixture indexing. The interesting part is that `Omit<Union, K>` does not
distribute, so a test helper had silently collapsed a seven-state `ToolCallPart` down to the fields
common to every state, dropping `input` and `output` from what it compared. That is a test asserting
less than it appears to, and only the typechecker could see it.

Two traps found on the way, both of which would have produced a confidently green non-result:

**`"types": ["bun-types"]` silently disables semantic checking.** It is the obvious spelling, and it
is wrong; the correct one is `["bun"]`. The wrong one emits a `TS2688` config error that does _not_
prevent per-file diagnostics from being skipped — so the typecheck passes while checking nothing.
Caught with a deliberate-error probe rather than assumed, which is the only way to catch it.

**`bunx tsc` does not run the repo's pinned TypeScript.** There is no `tsc` in the root
`node_modules/.bin`, so `bunx` fetches a fresh unrelated major (7.0.2 against a pinned 6.0.3) on every
invocation. `bun run typecheck` uses the pin; `bunx tsc` does not. They agreed on this occasion, which
is luck rather than a guarantee. Any validation that reports a typecheck result via `bunx tsc` is
reporting a different compiler's opinion than CI will.

### Disjointness has to hold for what an agent RUNS, not only what it EDITS

B2's lesson was that parallel lanes must not share files. B3 found the next layer down.

Two agents were dispatched in parallel on the strength of editing different files — one owned
`tsconfig.json`, the other owned `scripts/pack-test.sh`. Genuinely disjoint on disk. But `pack-test.sh`
_builds the package_, and the build reads `tsconfig.json`. The second agent watched its build fail
repeatedly against a `tsconfig.json` that was visibly flapping between states as the first agent
edited it, and had to construct a temporary known-good config to verify its own work honestly.

It reported this clearly and separated it from its own result, which is the behaviour the briefs ask
for. But the split was the orchestrator's error, not the worker's. The check before parallelising is
not "do these agents write to the same paths" — it is "does either one _execute_ something that reads
what the other writes". Build configs, lockfiles, generated artifacts and test setup files are all
read by tooling that a nominally unrelated lane may invoke.

### B3's gates, run as the repo's own scripts

| Gate                                                       | Result                    |
| ---------------------------------------------------------- | ------------------------- |
| `make build`                                               | 0                         |
| `bun run pre` (fmt:check + lint + typecheck + check-theme) | 0                         |
| `bun test`, from the repo root                             | 1518 pass / 0 fail        |
| `export-surface` regeneration                              | 7 insertions, 0 deletions |
| `scripts/pack-test.sh`                                     | 0                         |

The export-surface diff was verified semantically rather than by eye, as in B1: seven additions, zero
removals, and every one a VALUE export. Type-only exports never appear in that snapshot because the
generator reads `Object.keys()` of the built module — a worker's hand-off note had claimed the two new
composer types needed registering there, which would have failed the gate. An adversarial reader
caught it by auditing the hand-off note rather than the code.

`pack-test.sh` now prints `F2 proof: root entry resolved and evaluated with remend NOT installed at
all`. That is the guarantee F2 exists to deliver, asserted against the packed and installed artifact
rather than the source that produces it — the difference between "no static import appears in our
tree" and "the thing we shipped actually works without the peer".

### The playground gate earned its cost again, and found the slot that cannot be written to

Every framework gate was green — `bun run pre` 0, 1518 tests passing, `make build` 0, `pack-test` 0 —
before the playground demos were built. The gate then found three things, one of which would have
shipped a decorative API.

**`Composer.leftSection` has no way to write into the composer.** The spec's own example is
`leftSection={<VoiceRecordButton onTranscript={appendToDraft} />}`, and `appendToDraft` does not
exist. The draft lives in a module-scoped store keyed by `draftKey`, closed over inside
`composer.tsx`, with nothing exported to read or write it — the only exported door,
`readPersistedValue`, is read-only. The demo author could not build that half honestly and said so
rather than faking it with local state.

This is the whole point of the release. Composer grew slots in 1.12.0 _because_ A5 re-mounts argo's
voice layer into them; a recorder that transcribes speech and cannot put the text in the box is not a
slot. And the API is frozen shortly after — the recorded gate for "after B4, before A3" exists because
a later correction costs a major, which this repo forbids. It had to land now or not at all.

Unit tests could not have caught this. Every test of `leftSection` passes a `ReactNode` and asserts it
renders, which it does. The defect is not in the behaviour of the code; it is in what the code makes
possible, and that is only visible to someone trying to build the thing the API was designed for.

**A consumer's fence renderer that throws takes the message down.** `settledOnly` calls `render(ctx)`
unconditionally once settled, and there is no way for a renderer to decline. Fence bodies come from a
language model, so malformed content is routine, not exceptional — a `vega-lite` fence with invalid
JSON is a Tuesday. This is the third instance in this phase of the same rule (`spliceText` clamps
rather than throws; `coalesceParts` lost its runtime `assertNever`), and the argument is identical:
render-path code must not turn a transient content anomaly into a permanently dead transcript. Worth
stating as a standing invariant for this layer rather than rediscovering it a fourth time.

**A note on the gate's own scope.** `bun run check-theme` reads `basalt.roots` from package.json and
scans `packages/basalt-ui/src` only — it does not cover `apps/playground`. The demo author ran oxlint
over the playground separately and found two `basalt/card-inset` violations that the framework's own
theme guard would never have reported. Not a defect in this release, but the guard's coverage is
narrower than "run the repo's gate" implies, and a consumer-shaped tree is exactly where house-law
drift is most likely.
