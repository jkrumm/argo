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

### B3 closed — 1.12.0 published, and the review that ran after every gate was green

`basalt-ui@1.12.0` is on npm; seven commits rebase-merged to `master`; argo consumes it. The
round-trip was clean for the third release running, and for the same reason each time: argo imports
zero from `./agent` and `./agent-chat`, so a release carrying two source-breaking changes lands on
the consumer without a scratch. A3 is still where that debt gets paid.

Final state: `bun run pre` = 0, `bun test` = 1548 pass / 0 fail, `make build` = 0, `pack-test` = 0,
and in argo lint + format + check-theme + both typechecks + the dashboard build + 372 API tests all
green. `v1.11.0 → v1.12.0 (minor)`, as computed rather than chosen.

**The most expensive lesson of this phase is that a green gate is where verification starts.** Every
framework gate passed before the playground demos were written, and building them found that
`Composer.leftSection` had no way to write into the composer — which is the entire reason the slots
exist, since A5 mounts argo's voice layer in them. No unit test could have caught it: every test of
`leftSection` passes a `ReactNode` and asserts it renders, which it does. The defect was not in the
behaviour of the code but in what the code made possible, and that is only visible to someone trying
to build the thing the API was designed for.

Then CodeRabbit, running after all of that, found nine more. Eight were real.

**Two reviewers disagreed about the same line, and the more thorough one was wrong.** An adversarial
Opus pass executed the off-contract `contentTrust` path and reported it degraded gracefully to a
plain-text fallback. CodeRabbit flagged the same lookup as not failing closed. Probing all three
hostile values found something worse than either had described: an uncaught `TypeError` from
`url-hardening.ts` with no error boundary above it — a crash, not a degrade. The reviewer that had
run 4000-case differential fuzzing on the sanitize merge and 22 mutation tests was the one that got
this wrong, because it executed one case and generalised. Executed evidence is still only as good as
the case executed, and a clean verdict from one pass is not grounds to dismiss a second pass pointing
at the same code.

**And a finding can be half right and still worth acting on.** CodeRabbit's premise — that
TypeScript accepts any structural thenable where `Promise<void>` is declared — is false;
`Promise<void>` also requires `catch`, `finally` and `[Symbol.toStringTag]`. The gate caught the
resulting test as both a type error and an `unicorn(no-thenable)` lint error. But the underlying
defect was real for a better reason than the one given: a cross-realm _native_ promise has all those
members, so it is assignable, and `instanceof` still fails because it compares prototype identity
across realms. The fix stands; the fixture had to be rebuilt to model a real promise with a repointed
prototype, asserting `instanceof Promise === false` inside the test so it cannot silently degrade
into a same-realm promise and prove nothing.

**One scope call, recorded because the alternative was tempting.** Unguarded `crypto.randomUUID()`
turned out to be pervasive across the agent layer — seven production sites plus the shipped contract
suite — and B3 introduced exactly one of them. Fixing all of it days into a release cycle, in files
this phase never touched and with no review budget left, would have been scope creep dressed as
diligence. The two store `create()` sites were fixed because they are the direct analogues of the
flagged bug and both are user gestures; the rest is inventoried in B4's task with exact paths, and
with the distinction that matters: a weak id fallback is acceptable for a thread id and is **not**
acceptable for a message id, which is `appendMessage`'s documented idempotency key.

### Still open going into B4

The browser reproduction table in `HERMES-CHAT-V2.md` has never been walked for B3. Every gate in
this phase was tests and types, and that table exists precisely for what those cannot see — double
replays, lost messages, mid-fence flicker, a tool chip that never appears. It is the one step of the
phase loop this release skipped.

`bun run check-theme` reads `basalt.roots` and scans `packages/basalt-ui/src` only, so it never gated
`apps/playground`. Two `basalt/card-inset` violations were found there by running oxlint manually.
The playground's house-law compliance currently rests on a step nothing enforces.

The stopped-turn question — whether `stop()` clearing the resume token should stay terminal — is
still unanswered and stayed deliberately out of this release. It is a behaviour change, not a bug
fix, and it wants its own release note.

---

## B4 — basalt-ui 1.13.0

### The stopped-turn question, ruled

**`stop()` stays terminal.** Ruled by Johannes on 2026-08-03, closing a question that had been open
since B2. Stopping is an explicit "I don't want this"; resume exists for the _involuntary_ case — a
dropped connection, a reload. The partial turn is already preserved through `ChatMessage.finish:
'stopped'` (B2), so nothing is lost by refusing continuation, only continuation itself. And `retry()`
already covers "actually, keep going" by starting a fresh turn.

No behaviour change ships. The value of asking was not the answer but the closure: it was the last
release before the API freezes, so leaving it open would have meant carrying it past the point where
changing it costs a major.

### The browser gate, and what it is actually a gate on

B3 left the reproduction table unwalked. Re-reading the table before repeating "walk it" surfaced
that the instruction had quietly stopped meaning what it says: **every row in that table is an argo
dashboard defect, and argo imports zero from basalt's `./agent` and `./agent-chat`.** Walking it
against `argo.test` today exercises the untouched legacy `hermes-chat` feature. It would re-observe
the old defects and verify nothing B3 shipped.

The rows that B3 and B4 actually make drivable are in the **playground**: fence flicker and
tail-block settle, the sanitize extension, composer slots and draft-survives-reload, adapter
hydration and rollback, stop preserving partial text. So the gate was split — the playground walk
covers what the framework changed, and the argo table is walked against **production** (Johannes's
call: prod is live, so it costs no local stack) as a documented pre-migration baseline for A3 to be
diffed against.

Worth stating plainly because it generalises: a gate inherited from an earlier phase can keep its
name after it has lost its meaning. This one had been "the step we skipped" for a full release when
it was really "the step that does not apply yet".

### The research gate, and a wrong refutation caught by re-running it

Three facts resolved before the brief. Two of them contradict the spec.

**`@tanstack/react-virtual` needs no upgrade.** Installed is `react-virtual@3.14.3`, which pins
`virtual-core@3.17.1` — and 3.17.1 already carries the chat primitives (`anchorTo: 'start' | 'end'`,
`followOnAppend`, `scrollEndThreshold`, `scrollToEnd()`). That matters because it is exactly the
stick-to-bottom-while-streaming machinery a virtualized transcript needs once it stops being nested
inside `BasaltStickToBottom`, and the alternative — hand-rolling it on `scrollToIndex` — is the
documented janky path.

Getting there involved a self-inflicted detour worth recording. The first check for those primitives
grepped a file that `curl` had failed to download: **an empty file greps clean**, so the result read
as a confident "ABSENT" and nearly went into the brief as "the research report is wrong, do not use
`anchorTo`". The second attempt asserted the file existed and had lines before trusting the grep,
and found all four primitives present. Same failure shape as B3's `contentTrust` verdict, in the
opposite direction: there, one executed case produced a false clean; here, one _unexecuted_ case
produced a false absence. **A negative result from a tool needs its setup verified at least as hard
as a positive one** — a passing grep proves the pattern is absent from what was actually read, which
is not the same as absent from the package.

**React 19 `<Activity>` destroys effects.** `mode="hidden"` runs the subtree's effect cleanups and
re-creates them on show; React state and DOM state (scroll offset, textarea content) survive.

**The spec's Mantine `Collapse` claim is backwards — and will become true later.** §12 says the row
"does not use Mantine `Collapse`'s `keepMounted` default, which renders children inside React 19
`<Activity>`". On the installed `@mantine/core@9.3.0` the opposite holds: `keepMounted` is absent
from `defaultProps`, and the omitted-prop branch is `content = children` — children stay mounted,
hidden by CSS `display: none`. `<Activity>` is reached only when `keepMounted={true}` is passed
explicitly (which `app-sidebar.tsx:352` does today). But Mantine **master** has already flipped the
defaults to `keepMounted: true` + `keepMountedMode: 'activity'`.

So both the spec and the tree are right, about different versions, and the conclusion is stronger
than either: **a bare `<Collapse expanded>` gives the correct keep-mounted behaviour today and
silently stops giving it the day this repo bumps Mantine** — reintroducing gap-analysis defect 3, a
double stream replay, through an upstream default change nobody in this repo wrote. `ThreadFeedRow`
therefore owns its show/hide in basalt's own code rather than delegating the guarantee upstream. This
is the second time this program has found that the safe-looking option was a dependency's default.

### Four spec claims that did not survive the tree

A survey pass before briefing found §9's memoization work **already done** — `MessageBlock` is
already `memo`'d with a comparator, `coalesceParts` is already inside a `useMemo` (and never was
called inline in the render body as §9 claims), the renderers map is already memoized, and the
"one delta re-renders exactly one `MessageBlock`" budget test already exists and passes. The only
unbuilt part of §9 is virtualization. Briefing the lanes off the spec alone would have produced a
worker re-implementing memoization that was already there, then reporting it green.

Also corrected before briefing: §9's line anchors and comparator prop names (the real prop is
`streaming`; `settled` is derived), `PartList`'s `useMemo` anchor, and the fact that
`useAgentThreadRuns.retry` is **thread**-keyed while §11's `onRegenerate` is **message**-keyed — an
impedance mismatch the consumer bridges, not something to fix by changing `retry`.

The pattern is now consistent enough to state as a rule: **this spec's prose is reliable and its
line anchors and "today the code does X" claims are not.** Survey the tree before every brief.

### The playground walk found two defects in a release where every gate was green

Twenty-two scenarios, observed rather than assumed. What held: F1 — the tail block of a finished
message upgrades the instant the run ends, and `showCopy` appears with it; the sanitize extension
adds a tag across three toggle states while `<script>` is still stripped, with no injected global, no
inline `on*` attribute and no `javascript:` href; optimistic append and rollback; and the stopped turn
is genuinely terminal, surviving a close/reopen _and_ a full page reload with no resume affordance
anywhere on the page. The ruling recorded above is already what the code does.

**A5's blocker turned out to be closed.** B3's own playground gate had found that
`Composer.leftSection` gave a consumer no way to write into the composer — the defect that made the
slots decorative and that A5 depends on. 1.12.0 shipped the fix: `ComposerHandle = { insertText,
setValue, focus }` via `ref`. Verified by driving it, not by reading the type — caret at index 5 of
`"ALPHA BRAVO"` inserted in place, and with the composer unfocused it appended at the end per the
documented fallback.

Two new defects, both in code that shipped with `bun run pre` at 0, 1548 tests passing, `make build`
0 and `pack-test` 0:

- **`ThreadWorkspace` renders its empty state during hydration.** No component in `src/agent-chat/**`
  reads `hydrated` at all — it exists only in `agent/adapter.ts` and `agent/thread.ts`. It is
  invisible in the playground purely because the demo adapter seeds an empty `Map`, so there is
  nothing to flash _to_. A server-backed store holding real threads flashes empty-then-populated,
  which is exactly argo in A3.
- **A rolled-back `create()` leaves the user staring at the wrong error.** The dependent writes still
  fire and each fails with `unknown thread <id>`, overwriting the root cause: the surfaced error ends
  up `setStatus: unknown thread …` when the actual failure was the create, 1.3 seconds earlier. The
  rollback itself is correct; this is error _reporting_.

Both are in scope for B4, because 1.13.0 is the last release before the API freezes.

### The chrome-devtools MCP returns plausible answers from the wrong page

Worth recording as an environment failure mode, because it fails silently rather than loudly. Its
"selected page" is global to the shared MCP server, and another client kept stealing it — three
consecutive `select_page` → `evaluate_script` pairs executed against a different site's tab and
returned perfectly well-formed results. Nothing errors. A less careful agent would have reported
those as observations of the playground.

The workaround that worked, and should be the default for this program: launch a dedicated Chrome
with `--remote-debugging-port` and its own profile, and drive raw CDP. The MCP's browser runs with
`--remote-debugging-pipe`, so there is no port to attach to. The dedicated instance also unlocks
pre-boot `addScriptToEvaluateOnNewDocument` instrumentation, which the MCP does not expose — and that
is what caught the hydration defect above.

### P1's "render-only" verdict is true of the data and false of the wire

The argo half of the gate walked the reproduction table against production. Four rows reproduce
(3, 8+2, 9, 10+11), three do not, one is untestable on a prod build.

The finding that changes another phase's premise is row 1. Collapsing mid-stream and re-expanding
fires **one** `POST` and **one** `GET …/stream` — and that stream is a 111 KB replay of the turn
**from character 0**, reusing the same `messageId` and the same `text-start` id, so the client
appends rather than replaces. The bubble ended up holding `1…168` followed by a full `1…1000`, one
seam at line 168.

P1 concluded the duplication is RENDER-ONLY. That is right about the data — one LLM run, and the DB
holds a single clean 3,898-char row — and wrong about the wire, where a full second stream really
does cross the network. **Any A1/A2 design that assumed nothing re-crosses the network on re-expand
is built on a half-true premise.** It remains consistent with the standing "do not fix the resume
offset" rule: v7's `reconnectToStream` sends no `Last-Event-ID` and no offset, so the server has
nothing to skip from. The fix is client state seeding, exactly as recorded.

Three more things the table did not ask about, all routed into A1:

- **A second `POST` during a live stream returns 200, not 409**, reaps the in-flight run (persisted
  `interrupted` at 420 chars) and writes four rows for one exchange. In one run the second POST's own
  SSE response streamed back the _first_ run's content — defect 6's pointer-reaping, visible from the
  client. The dashboard UI gates this today (Send swaps to Stop, Enter is a no-op, zero second POST),
  so it is not user-reachable; the endpoint is unguarded and A2 moves the transport.
- **Thread-list polling runs every 700 ms–1 s continuously** for as long as the page is open.
- **A resume `GET` fires on every `ChatView` mount** — including brand-new threads that have never
  streamed (204) and every expand of a long-finished one.

And two rows that did **not** reproduce are worth as much as the ones that did. Stop-mid-generation
already preserves the partial text through a reload, persisted `interrupted` — argo's own
implementation is correct there. The mermaid fence showed zero error boxes across 246 samples at
30 ms; the real transient is a raw `<pre>` upgrading to the SVG in well under a second. That one
carries a caveat rather than a clean bill: Hermes delivered those replies in one or two large bursts
rather than token-by-token, so the mid-fence window was narrow. Latent, not proven absent.

One incidental finding for A3's benefit: `payload.toolEvents` persists richly — six events over three
calls — and one label embeds a shell command containing a secret's env-var name. Rendering
`toolEvents` verbatim would put that on screen.

### The convergence pass paid for itself on the first defect it found

B4 ran as a foundation lane, five lanes disjoint by file, then a convergence pass whose only job was
the seam. Every lane reported green on its own files. The convergence pass then found seven defects,
and the first one is the exact shape B2 warned about:

**`ThreadFeedRow` declared `affordances` and never forwarded it.** Lane 3 wrote
`affordances: _affordances` because at the time it wrote the row, `ThreadTranscript` had no such
prop. Lane 2 then added `affordances`, `groupConsecutive` and `virtualize` to
`ThreadTranscriptProps`. Both halves compiled. Both lanes' tests passed. The pair silently did
nothing — a row that accepts an affordances object and drops it on the floor. No type error and no
single-component test can see that, because each half is individually correct. It also meant a
virtualized inline row was not _expressible_, which is the same defect class as B3's
`Composer.leftSection`: an API that looks complete and cannot do the thing it exists for.

The other six: a `check-theme` violation Lane 2 shipped because it was told not to run `check-theme`
(a raw `<div>` inside the virtualizer — `bun run pre` exits 1 on it); two hard-pinned `'warn'`
assertions that Lane 6 correctly refused to fix outside its scope; `surfaces.ts` missing the new
optional peer, which then cascaded into three more gates nobody would hit running only their own
files (`agents-sync`, `llms-sync`, `gen-llms --check`); an unregistered shadowed surface; incomplete
barrels; and a `height!` assertion that a second consumer would have duplicated, replaced with a
single `resolveVirtualize()` narrowing point.

**One lane correctly did nothing, and that is the most interesting result.** Lane 5's brief — model
the `toolCallId` empty-string sentinel, add the orphaned `approval-responded` test — was carried
forward from B2's review inventory. It was stale: B3's `d47a35f` had already landed
`Identified`/`MaybeIdentified` in `parts.ts` and the orphan test in `coalesce.test.ts:200`, complete
with a design note explaining why the fold deliberately does not backtrack. The worker verified this
and wrote nothing rather than inventing work to justify its existence. Verified independently before
accepting it: both are at HEAD. **The carried-inventory list in a phase handover ages the same way
the spec's line anchors do** — check each item is still open before briefing it.

Lane 2's report was also not a reliable inventory of its own work: it claimed two files exclusively,
having also modified `thread-outcome-card.tsx` and created five new files. The work was good; the
self-report was not. Read the diff, not the report — which is what the convergence pass did.

Gates, run twice: once by the convergence agent and once independently afterwards, because a green
gate is a claim. `make build` 0, `bun run pre` 0, `bun test` 1611 pass / 0 fail across 82 files,
`pack-test.sh` 0 including agent-chat resolving with `@tanstack/react-virtual` **not** installed.
Export surface: two additions, both the same new VALUE export (`ThreadFeedRow`, root plus subpath),
zero removals, no type-only export leaked.

**One piece of latent fragility, recorded because it will bite later.** happy-dom has no layout or
scroll engine, so `anchorTo: 'end'` is not genuinely observable in it. An anchoring assertion in
`thread-message.test.tsx` passes today only because it is the only file asserting anchoring; a second
file asserting the same thing failed in the same bun process **in either order**. The convergence
agent rewrote its own test to assert windowing instead and left the original alone. If a third file
ever renders a virtualized transcript, expect a flake. The honest fix is the browser gate, not more
happy-dom shimming.

### Two review passes, and the more careful one disagreed with the thorough one

Both ran after every gate was green. The multi-angle pass returned `needs-human` with two blocking
findings. The independent adversarial pass found a **third, worse** one that neither the workflow nor
the multi-angle review had seen — and it found it by probing rather than reading.

**`formatRelativeTime` throws `RangeError` on the render path.** Fourteen values probed, not one:
`NaN`, `±Infinity`, `undefined` and an ISO date string all throw; `null` coerces to 0 and renders
"57 years ago". The throw escapes render in all three consuming components, and there is **no error
boundary anywhere** in `agent/` or `agent-chat/` — so one bad `createdAt` blanks the entire
transcript. B4 multiplied its reach from one call per inbox row to one per settled message. And it is
reachable without a consumer bug: `createdAt` comes back from `localStorage` JSON or a consumer's
adapter, and a server returning `created_at` as an ISO string is the single most likely adapter
mistake. The contract suite's `typeof thread.createdAt === 'number'` passes `NaN` and never checks
`message.createdAt` at all.

The sharpest part is that it violates the standing invariant **quoted verbatim in the same diff** —
`id.ts:78-80` cites `spliceText` clamping and `coalesceParts` degrading as the layer's rule, and
three lines away `mergePart` clamps a NaN and warns. The new code throws.

**Where the two reviewers disagreed, the adversary proved its case and the thorough one was wrong
again.** The multi-angle pass called the keep-mounted invariant violated by a Suspense fallback
swap. The adversary built a deliberately-broken copy of the component first, confirmed its
effect-counting probe could detect a remount (mutant: 1 → 2), and only then reported the real one
holds — ten collapse/expand cycles, a reorder through `AnimatePresence popLayout`, and fresh object
identities all stayed at one effect run. That is the discipline B3's `contentTrust` verdict lacked,
applied in the opposite direction: prove the instrument works before trusting a clean reading.

The residual it did confirm was narrower and led somewhere better. The Suspense fallback renders the
full row tree, so it remounts once when the lazy import resolves — and that same fact meant a test
asserting end-anchoring resolved from the fallback at tick 0, regardless of whether virtualization
worked at all. A dead assertion inside a live test. One fix — a lightweight placeholder — closed
both.

Also worth carrying: **`ThreadFeedRow` had a second "declared and not forwarded" defect**, in the
same file where convergence had already caught one. It documents `onStop` as "shown as the composer's
Stop action while streaming" and never passes `streaming` to `Composer`, which gates on exactly that.
Executed: Stop never appears and the composer is never disabled mid-run — so a consumer's user can
fire a second turn into a live thread, which prod forensics showed writes four rows and reaps the
running turn. Prose describing behaviour that no wiring implements, twice, in one component.

### The fix round introduced a defect, and convergence caught it by executing the public API

Five fix lanes, then a convergence pass. The pass found that the transcript lane's fix for a
memoization complaint had wrapped **both** `onRegenerate` and `actions` in a latest-ref stabilizer.
For `onRegenerate`, an event handler, that is right. `actions` is a **render prop** — it is called
during render to produce nodes — so freezing its identity froze the JSX React reconciles. A consumer
rendering `actions: () => <span>count {n}</span>` still showed `count 0` after `n` changed.

That is a silent break of a documented public API, introduced by a fix, at the release where the API
freezes. It was caught because the convergence agent executed the consumer-facing behaviour rather
than reading the diff — and the lane's own report had argued the design call without ever
distinguishing a handler from a render prop.

Convergence also found the `finalizeStop` guard was **half-closed**. The lane wrapped the two lines
it was briefed on (`mintMessageId` + `appendMessage`) and left `setStatus`/`setResumeToken` — the
same consumer adapter, the next two lines — bare. A throw there still skipped the `setRuns` teardown,
which is the hook's own state and is what reports "a turn is in flight" to the UI. Identical wedge,
one line further down. **A brief that names specific lines gets those specific lines fixed**; the
generalisation has to be asked for explicitly.

Gates after the round, exit codes read directly rather than trusted from a report: `make build` 0,
`bun run pre` 0, `bun test` 1641 pass / 0 fail, `pack-test.sh` 0. Worth noting the offloaded check
tool returned `failed` on its own output serialization while its narrative claimed green — exactly
the ambiguity this program keeps getting burned by, and the reason the exit codes were read by hand.

### The guard promotion breaks the consumer, which is the point

Verified directly rather than taken from the review: argo extends the shipped preset
(`./node_modules/basalt-ui/configs/oxlint.json`) and `chat-conversation.tsx` imports `useChat` from
`@ai-sdk/react` with `resume: true` — the literal targets of `agent-no-raw-usechat` and
`agent-resume-guard`, both going `warn` → `error` in 1.13.0. Plus four raw scroll containers with no
`theme-allow`.

Decision: promote as planned, and land argo's compliance in the same round-trip. The four scroll
containers get real `theme-allow` declarations — they are legitimate scroll owners, so that is
correct work rather than a suppression. The two agent rules get explicit suppressions naming A2/A3 as
the removal point, which puts argo's migration debt in the code where it is visible and gives A3 a
natural checkpoint to delete them. Erroring the reference consumer for code that is about to be
deleted is a little noisy, but these rules exist precisely to force that migration, and leaving them
at `warn` would waste the guard.

### The B3 browser defects, fixed — and a fix that was correct for 200 milliseconds

D1 and D2, both found by the playground walk after 1.12.0 had shipped green, were closed in this
release rather than carried past the freeze.

**D1 — the hydration flash.** `ThreadWorkspace` now holds a neutral skeleton while
`!hydrated && threads.length === 0`, rather than rendering "no threads yet" at a store that has
simply not answered yet. Two constraints made this more than a one-line guard, and both were
verified rather than assumed: a cache-then-revalidate consumer with `hydrated: false` and a populated
`threads` array must not be blanked, and the synchronous `createThreadsStore` pins `hydrated: true`
always — if it could be `undefined`, the same guard would give every synchronous consumer a permanent
skeleton. The lane checked that against `thread.ts` and its existing pin test rather than branching
on a guess.

**D2 — the error cascade, fixed twice.** The lane's fix dropped queued dependent writes whose target
thread had rolled away, and its report argued the case well, including a careful paragraph on why
multi-id writes like `clear()` are excluded. Convergence found it covered roughly the first 200
milliseconds. `failedCreateIds` was cleared when a thread's write chain drained — but the cascade is
not confined to the synchronous send path. `useAgentThreadRuns`' **completion path**
(`appendMessage` → `setOutcome` → `setStatus` → `setResumeToken`) fires when the stream _ends_, long
after that chain has drained, against the same rolled-back row, latching "unknown thread" over the
create's real error at exactly the moment the user is looking at it.

It was reproduced before being re-fixed — a new test went red against the lane's own code, showing
`appendMessage` and `setStatus` firing after the drain. The record is now retained for the store's
lifetime, which is bounded because `create()` always mints its own id and an id in the set can never
be re-created.

The pattern is the standing invariant again, on a delay: a transient failure still turning into a
permanently misleading transcript. It is worth noticing that the lane's reasoning was not sloppy —
it was thorough about the wrong time window. **A fix verified against the scenario that motivated it
is not verified against the scenario it will actually meet.**

**And one lane cited a document that does not exist.** The hydration lane's report closed with a
"noticed, not touched" item: that `adapter.ts:172-173` documents hydration gating as the consumer's
job, now stale. Convergence checked. That text is not there — `:176-177` says something else
entirely, and nothing anywhere made that claim. The lane had been briefed with that quote (it came
from the browser walk's own report) and echoed it back as an observation of the tree. Worth carrying:
a lane report can launder a brief's assumption into an apparent finding, and the only defence is
checking citations against source — which is the same rule this program already applies to the spec's
line anchors.

Gates: `bun run pre` was red on arrival on a file the cascade lane never ran the format gate over
(its report said "all green" and listed `tsc` and `oxlint`, not `oxfmt` — the third time a lane's
green claim covered only the checks it happened to run). Final: `make build` 0, `bun run pre` 0,
`bun test` 1649 pass / 0 fail across 83 files, `pack-test.sh` 0, `oxlint apps/playground/src` 0
across 96 files, playground typecheck 0 against a rebuilt dist.

### The playground has never been theme-gated, and now it is measured

`check-theme` reads `basalt.roots` from `packages/basalt-ui/package.json` and scans
`packages/basalt-ui/src` only; it cannot be pointed elsewhere from the CLI. B3 noticed the hole and
found two violations by running oxlint by hand. B4 measured it properly, by running the guard against
a copy of `apps/playground/src` with a synthetic root: **47 findings, all pre-existing, none in any
file this release added.**

Not fixed — a 47-finding sweep across untouched demo pages on release eve is not a convergence
change. But it is now a task with a real number attached rather than a vague misgiving, and the
permanent fix is a `basalt` block in `apps/playground/package.json` so the guard covers the
consumer-shaped tree that is most likely to drift.

### The browser gate found the two worst defects of the phase, after everything was green

1649 tests passing, four repo gates at 0, two review passes acted on, three convergence passes. Then
a human-shaped walk through three demo pages in a real Chrome found this.

**An aborted run leaves a phantom that nothing can clear.** The effect cleanup at
`use-agent-thread-runs.ts:492-499` aborts every controller and clears `controllersRef` and
`appendedRef` — and never touches `runs`. `consumeAndFinalize` returns early on abort with no
teardown, so the entry is orphaned; `stop()` then early-returns forever because the controller it
looks for is already gone. The mount-reconcile effect does set the thread to `'interrupted'`, but the
phantom entry still feeds `liveStatus: 'streaming'` to the row, which disables the composer. **The
state is unrecoverable for the hook's lifetime**: a thread that looks like it is streaming, cannot be
stopped, and cannot be typed into.

Observed as three threads permanently stuck on page load, reproduced 4/4 including once with zero
page instrumentation, with a pre-boot `AbortController.abort` trap capturing all three aborts inside
a React effect-destroy frame.

The trigger visible today is StrictMode, which is dev-only. **The reason it is blocking anyway is
written in the cleanup's own comment**: it says the path is reachable "whenever this fiber's effects
re-run without the fiber itself unmounting (React 19 StrictMode double-invoke; `<Activity>` hide/show)".
`<Activity>` is exactly what Mantine master's new `Collapse` defaults wrap children in — the same
upstream change `ThreadFeedRow`'s module doc exists to defend against. A consumer putting a
`useAgentThreadRuns` list inside a future Mantine `Collapse` gets a permanently dead composer in
production. Two independent findings this phase now converge on that one upstream default flip.

**Collapsing a virtualized row silently scrolls the transcript somewhere else.** Scroll to message
#96, collapse and re-expand three times without touching the scrollbar, and the top visible message
walks #96 → #111 → #119 → #126 while `scrollTop` stays pinned at 15,000. The content moved thirty
messages under a stationary viewport.

The mechanism was probed rather than inferred: reading the sizing box's inline height while the body
is `display: none` shows `getTotalSize()` collapsing within 50ms of the toggle and rendered rows
going to zero. TanStack's `resizeItem` writes whatever the ResizeObserver reports **with no `size > 0`
guard**, so every row measures 0 the instant an ancestor is hidden, and the cache is permanently
poisoned. The convergence pass had flagged this exact interaction as unverifiable in happy-dom and
listed it for the browser gate. It was right to, and the answer was that it is broken.

Note what did **not** happen: the demo author's stated fear was a zero-height pane needing a window
resize. The pane comes back scrollable at the correct height. The real failure is quieter and worse —
it shows you a different part of the conversation and nothing looks wrong.

### What the four never-verified behaviours actually do

`anchorTo: 'end'`, `followOnAppend`, `scrollEndThreshold` and variable-height `measureElement` had
shipped on the strength of a research note, because happy-dom has no layout or scroll engine and a
grep of the whole test tree for them returns one hit that is a comment. Driven for the first time:

- **`followOnAppend` is correct in both directions.** At the bottom, appending moved `scrollTop`
  31,006 → 31,100 and held distance-from-end at 0. Scrolled up 4,000px, appending moved it by
  exactly 0 — no yank.
- **`scrollEndThreshold`'s 64px band is real and sharp**, probed at four points rather than one: 0px
  and 40px from the end follow; 70px and 200px do not.
- **`measureElement`'s geometry is exact** — zero overlaps and zero gaps at 25 sample points across a
  full 500-message descent, stable on the way back up, and a mid-list window resize held both the top
  visible index and `scrollTop`. But `estimateSize` defaults to 96 against a measured mean of ~145,
  so total size climbs 49,486 → 72,448px over one descent and the scrollbar thumb shrinks
  continuously for the entire first scroll down. Tuning, not correctness.
- **`anchorTo: 'end'` is still unverified**, and that is itself a finding: no demo streams into a
  _virtualized_ transcript. The inline row is not virtualized, the virtualized row never receives
  live parts, and the 500-message page is static. The one behaviour that exists specifically to keep
  a streaming transcript pinned has never had those two halves put together, in a test or a demo.

### Two process notes worth more than any single defect

**The gate agent nearly filed a false blocker and caught itself.** Its first probe for the Regenerate
control queried `button[aria-label="Regenerate"]` and returned zero hits across the whole page. The
control is an `UnstyledButton` with a text child and no aria-label. Re-querying by text found it
working correctly. One selector, one confident wrong answer — the same failure shape as B3's
`contentTrust` verdict and as this phase's empty-file grep, now three times in three phases. The
discipline that saves it is always the same: probe a second way before concluding.

**Every serious defect this phase came from execution, and none from reading.** The render-path
`RangeError` came from probing fourteen values. The frozen render prop came from rendering a consumer
component and watching a counter not update. The phantom run came from a pre-boot abort trap. The
poisoned virtualizer came from reading an inline style while the element was hidden. The reviews that
read code carefully produced useful refinements; the reviews that ran code found the defects that
would have shipped.

### The fixes, and a seam that would have made the re-walk prove nothing

**The phantom run** is fixed in the unmount-cleanup effect, which now tears down the `runs` entries
for exactly the threadIds whose controllers it just aborted — the teardown set is read from
`controllersRef` at the same instant those controllers are aborted, so it is identical to the abort
set by construction rather than by assertion. `consumeAndFinalize`'s abort guard was deliberately
_not_ touched, and now carries a comment saying why: a teardown there cannot distinguish "aborted,
nothing replaced it" from "a newer resumed run already owns this key", so it would clobber a
legitimately superseding run. The "exactly one writer per terminal path" invariant that makes
double-append impossible is preserved. `stop()` also now settles a thread whose controller is already
gone, rather than no-opping into the unrecoverable state.

**The poisoned cache** is fixed with a `size > 0` guard rather than by gating the whole virtualizer.
The lane checked `enabled` — the option the brief proposed — against virtual-core's installed source
and found it _wipes_ `itemSizeCache` and `measurementsCache` rather than pausing measurement, which
would have made the drift worse. It pushed back on the brief and was right. The guard treats a 0
measurement as unreliable and returns the row's last cached size, which also covers any other cause
of a 0 measurement, not just this one.

**And then convergence found the seam that mattered most.** The framework's
`DEFAULT_VIRTUALIZE_ESTIMATE_SIZE` moved 96 → 160. The demo page built to observe that fix had its
own `DEFAULT_ESTIMATE_SIZE = 96` constant, with a comment claiming it mirrored the framework's
internal default — and because that page _always_ passes the object form of `virtualize`, the shipped
160 is the one value it could never exercise. The browser re-walk would have scrolled with 96,
observed the same shrinking scrollbar, and concluded the fix did not work.

That is a new shape worth naming: **not a broken fix, but an instrument calibrated to the old
value.** Neither lane could see it — one owned the framework constant, the other owned the demo
constant, and each was internally consistent. It is the strongest argument yet for a convergence pass
that reads the combined diff rather than the union of the reports.

Convergence also found a shipped source file whose module doc asserted the phantom-run defect was
still unfixed and pointed the next reader at `consumeAndFinalize`'s guard — the exact place the fix
was deliberately _not_ put, and where a "helpful" edit would clobber a resumed run. Under a freeze,
a confidently wrong comment is a live hazard.

Gates after the round: `make build` 0, `bun run pre` 0, `bun test` 1653 pass / 0 fail, `pack-test` 0,
playground oxlint 0, playground typecheck 0. `pre` was red on arrival on the format gate for the
third round running, on files a lane never ran `oxfmt` over — its report listed `oxlint` and `tsc`
and, accurately, never claimed `oxfmt`. The lesson is not that the lanes are careless; it is that
**"all green" in a report means "green on the checks I chose to run"**, and only the repo's own
script settles it.

### The re-walk: fixed, not moved — and the fix proved causally

Both serious defects are closed, and the walk went out of its way to establish that rather than
observing an absence.

**The phantom run could not be recreated by any route.** Eight were tried — reload mid-stream, SPA
navigate away and back, send-then-reload at 60ms, collapse mid-stream, reset mid-stream, two
concurrent runs then reload, an instant Stop before any content arrived, and browser back/forward.
Every one left all three rows expandable with an enabled composer. Stop now appears mid-stream, halts
the stream, and re-enables the composer.

**The poisoned cache holds across 13 collapse cycles**, with `scrollTop` 15,094, `getTotalSize()`
31,963 and top-visible message #96 byte-identical every cycle, plus the adjacent cases the original
report never covered: collapsing at the very top, at the very bottom, and 60ms after expanding before
rows have measured. The number that confirms the mechanism is that `getTotalSize()` **while
collapsed** also reads 31,963 — the guard is holding last-good sizes rather than committing the zero.

**And the scrollbar fix was proved causally, not just observed.** Setting `estimateSize` back to 96
reproduces the old pathology on demand: total size grows **+62.9%** across a descent and the thumb
shrinks to 0.61×, against −1.0% at the shipped 160. That is the difference between "the symptom went
away" and "we know what caused it, and we can turn it back on."

`anchorTo: 'end'` was finally observed, on the demo built for it. Streaming from the bottom held
distance-from-bottom at 0 across the whole run. Scrolled up 700px mid-stream, **`scrollTop` drifted
by exactly 0 across 40 samples over 16 seconds** while the live row grew — the viewport held.
Scrolling back down resumed following with no extra click. The one behaviour that had shipped on a
research note is now the best-evidenced thing in the release.

### The gate found one more thing, and it was an owner call

**A virtualized transcript mounts at the oldest message**, and a consumer cannot change it — no
initial scroll, no ref, no imperative handle, and `VirtualizeOptions` is `{ overscan, estimateSize }`
only. `anchorTo`/`followOnAppend` keep you pinned once you are within 64px of the bottom; neither
gets you there.

Not a regression, and nothing in `virtualize.ts`, `AGENTS.md` or `llms.txt` claims otherwise. But it
is the same shape as B3's `Composer.leftSection`: an API that looks complete and cannot do the thing
a consumer actually needs. A chat transcript that opens at the oldest message is wrong for chat, A3
rebuilds argo's dashboard on this API, and the API freezes after this release — so "ship it and
revisit" meant a major, which this repo forbids.

**Johannes ruled: open at the newest message by default, with a prop to opt out.**
`VirtualizeOptions` gains `initialScroll?: 'end' | 'start'`, defaulting to `'end'`. Type-only export,
so the runtime surface does not move.

Worth noting how it was found. The walker's first attempt at the anchor test produced nothing —
`followOnAppend` correctly did nothing, because a fresh load lands 8,913px from the bottom and
following only applies within the threshold. A less careful walk would have logged "follow did not
fire" as a defect in `followOnAppend`. Instead it scrolled to the bottom first, got a clean result,
and then asked the better question: _why was it not at the bottom to begin with?_ **The most valuable
finding of the gate came from a test that initially appeared to fail for the wrong reason.**

### The fix for the ruling was itself broken, and the tests said it worked

`initialScroll` shipped its first implementation with every gate green — `make build` 0, `bun run
pre` 0, 1666 tests passing, `pack-test` 0 — and it did not work. All three virtualized pages opened
at message #1, deterministically, 8 of 8 fresh loads.

Captured by hooking `Element.prototype.scrollTo` before page script, with stack traces, identical
every run:

```
{top: 0,     via: _willUpdate(anchor)}        after=0        ← element attach
{top: 79440, via: scrollToEnd(initialScroll)} after=79440    ← the fix fires and lands
{top: 0,     via: _willUpdate(anchor)}        after=0        ← clobbered ~1ms later
```

virtual-core's `_scrollToOffset` sets an _intended_ offset and never `this.scrollOffset`, which only
updates from the async `scroll` event — so the next commit's anchor branch writes the stale zero back
over it. The guard had already marked itself applied, so nothing retried.

**The two halves were a clean controlled A/B of one mechanism.** Mounted hidden, the initial scroll
defers to a later commit, lands after the anchor write has settled, and works — verified at seven
separate timings. Mounted visible, it fires inside the first commit burst, races that same write, and
loses. The retry path built for an edge case was carrying the whole feature; the common path had no
protection at all.

**And the unit tests were right about something that was not the thing.** They assert that
`scrollToEnd` was _called_, and it is called. The assertion is true; the feature does not work.
happy-dom has no layout or scroll engine, so effect is unobservable there — and the lane said exactly
that, declined to write a test that would look like coverage, and flagged it for the browser gate.
That is the distinction worth keeping: this is not one of the tests that quietly could not fail. It
is a test that proves intent, honestly labelled as proving intent, in a codebase where intent and
effect had never been shown to diverge until they did.

The fix is verify-then-settle: the scroll is not considered applied when it fires, only when a real
`scrollTop`/`scrollHeight`/`clientHeight` read on a later commit confirms it survived, re-firing if
clobbered, bounded by an attempt cap so it can never fight a moving target forever. Gates
re-verified by hand afterwards: build 0, `pre` 0, `bun test` 1668 pass / 0 fail, `pack-test` 0.

### An environment fact this program has been carrying wrong

**The playground dev server aliases `basalt-ui` to `packages/basalt-ui/src`, not `dist`** —
`apps/playground/vite.config.ts:11-14`, with a comment saying the playground is deliberately the
everyday iteration surface on source. Earlier notes in this record and in the handover said the
playground consumes the built `dist`, and several rounds spent effort rebuilding "so the browser walk
does not test stale code". For the **dev server** that was never necessary.

It remains true, and separately, that `check-theme` and the playground's `typecheck` read the built
`dist` — so `make build` is still a real gate, and a `tsc`-only error in a test file is still
invisible to `bun test`. The correction is narrow but worth making precisely, because "rebuild before
the browser walk" was being applied as a general rule derived from a fact about a different command.

### Three ways a browser check has now gone wrong

Worth listing together, because each failed _silently_ and each would have produced a confident wrong
answer:

1. **The chrome-devtools MCP served results from another client's page.** Its selected page is global
   to the shared server; `select_page` → `evaluate_script` returned well-formed output from an
   entirely different site. Nothing errors.
2. **A grep against a file `curl` had failed to download.** An empty file greps clean, so an absent
   pattern read as a confident "not present".
3. **A verification agent drove the wrong application.** Dispatched to check the playground on
   :7710, it ended up on a different project's dev server on :7715 and reported findings about an
   unrelated page.

The countermeasure that works is the same in all three cases and costs almost nothing: **assert the
instrument is pointed at the right thing before trusting what it says.** Verification tasks in this
program now carry an explicit "state the URL, state which app, state that you started the server"
preamble for that reason.

### The review round: eleven findings, six real, and three rejected on a false premise

CodeRabbit reviewed the release branch. Eleven actionable findings, ruled: **six fixed, five
rejected.** The rejections are the more instructive half, because three of them were rejected for
the same reason — the finding's _premise_ was wrong, not its concern.

- **The export-surface manifest "missing" four names.** `scripts/export-surface.mjs:42-45` imports
  the **built `dist/` entry** and lists `Object.keys()`. Type-only exports are erased by the build,
  so `ThreadFeedRowProps`, `VirtualizeProps`, `VirtualizeOptions` and `MessageAffordances` — all
  `export type` — cannot appear there. Their absence is the manifest working. The earlier B4 audit
  ("two additions, both the same new VALUE export, no type-only export leaked") was re-tested and
  confirmed: `dist/agent-chat/index.js` exports exactly nine names, matching `export-surface.json`
  byte for byte, and the four sync tests pass 45/0.
- **"Use the shared degraded-crypto ID helpers" in the playground.** `mintThreadId`/`mintMessageId`
  are not exported — the `./agent` barrel re-exports only `withPartIds` from `id.ts` — so the
  playground cannot call them across the package boundary at all. The finding also counted four call
  sites where there are 53 across 15 files, and the playground is always a secure context
  (localhost + Caddy TLS), so `crypto.randomUUID` is never undefined there.
- **"Add explicit return types to the exported page components."** One of sixty exported demo pages
  carries `: JSX.Element`. Annotating only the four new files would have manufactured the
  inconsistency it claimed to fix.

The fourth rejection is worth recording on its own, because the proposed fix was this phase's own
worst defect, offered back as a remedy. A second review pass asked for `throw new RangeError` at the
top of `buildLongThread` to reject a non-integer `count`. Every one of its three callers passes a
module-level constant inside `useMemo` or render — and this is the same package where
`formatRelativeTime` throwing on the render path blanked the entire transcript, because there is no
error boundary anywhere in `agent/` or `agent-chat/`. **Adding a render-path throw to guard an
unreachable input is a net loss.** Declined.

The fifth, reduced-motion on the affordance row, is real doctrine but was deferred rather than
rejected: the written rule (`agent/rules/basalt-mantine.md:358-364`) is scoped to the `motion/react`
JSX-prop layer, the shipped guard's regex (`src/guard/index.ts:184-186`) deliberately excludes
CSS-string transitions and says so in a comment, and fourteen in-package sites hardcode
`120ms ease`. Fixing the one flagged line would have made `thread-message.tsx` the outlier. The
honest fix is a class-wide `prefers-reduced-motion` block following `controls.module.css:209-213`.

### The release's own fix had introduced a worse failure than the one it fixed

The highest-value finding: **a failed initial load rendered a loading skeleton forever.**

`adapter.ts:343` is the only `hydrated = true` in the package, and the `catch` at `:348-355` sets
`error` and never touches `hydrated`. `ThreadWorkspace` rendered `FeedHydratingState` on
`!hydrated && threads.length === 0`, and **no component under `src/agent-chat/**`read`store.error`at all** — the sole`.error`match was`part.errorText`in`tool-chip.tsx`, unrelated.

What makes it more than an oversight is that the contract already specified the fix.
`thread.ts:146-147` documents the exact discriminant — "`!hydrated && error !== undefined` is a
failed load, `!hydrated && error === undefined` is still loading" — and three lines later asserts
that "the shipped `ThreadWorkspace` already does it internally." It did not. The package documented
a distinction it never made.

This shipped in `f00bf6d`, on this branch: **the D1 hydration-flash fix.** Before it, a failed load
showed "No threads yet" — wrong, but terminal and legible. After it, an indefinite skeleton that
implies work in progress. The four tests added alongside it cover `{hydrating,empty}`,
`{hydrating,populated}`, `{hydrated,empty}` and the sync store; **none constructs
`error !== undefined`.** The playground masked it too, rendering its own error text _outside_
`ThreadWorkspace`.

Fixed by splitting the `!hydrated` arm on `store.error !== undefined`, with an optional
`errorState?: ReactNode` override. Retry was deliberately **not** added: an optional additive member
on `ThreadsStore` stays legal after the freeze, so `refresh()` can be a later minor, whereas getting
the store interface wrong now is expensive. A failed load is therefore legible but still
reload-only.

The generalisation was asked for explicitly this time rather than left implicit, and the sweep came
back clean: `thread-detail-panel.tsx:148-159` already branches `status === 'error'` into an Alert
with Retry, and `OutcomeSkeleton` gates only on `pending`/`streaming`. One instance, not a class.

### A peer range that was one patch too low, and the crash it would have caused

`package.json:193` declared `@tanstack/react-virtual >=3 <4`. `thread-message.tsx:886-895` calls
`virtualizer.scrollToEnd({ behavior: 'auto' })` with no `typeof` guard, on the **default** path
(`initialScroll` defaults to `'end'`), inside a layout effect — and the lazy-import `.catch()` at
`:930` covers import _rejection_ only. So an old-but-present peer does not degrade to the documented
unwindowed pane; it throws a `TypeError` that escapes into render.

Verified from downloaded, size-asserted tarballs rather than a changelog: all four APIs
(`scrollToEnd`, `anchorTo`, `followOnAppend`, `scrollEndThreshold`) land together in
`@tanstack/virtual-core` **3.16.0** and are absent in 3.15.0 (`dist/esm/index.d.ts`, 190 lines vs
178). The pin mapping is the non-obvious part: `react-virtual@3.13.25 → core 3.15.0` but
`3.13.26 → core 3.16.0`, so the floor is **3.13.26**, not the 3.14.0 the version numbers suggest.

Raised to `>=3.13.26 <4` and mirrored in `pack-test.sh:78` and the regenerated `llms.txt`.

### What the convergence pass caught this time

Reading the combined diff rather than the report found one thing the lane missed, and it is the same
shape as the demo constant pinned to a pre-fix value: **three shipped source files still documented
the old range as their own requirement** — `src/data/index.ts:10`, `src/data/virtual-list.tsx:4` and
`src/data/virtual.ts:5`, all saying `>=3 <4`. `src/` ships in the tarball, so those were false
statements in the published artifact the moment the peer moved.

The nuance that makes them worth more than a search-and-replace: npm allows one peer range per
package, `BasaltVirtualList` genuinely works on any 3.x, and the floor exists only because
`./agent-chat` needs it. A reader who noticed that could reasonably "fix" the range back down. Each
comment now says why the floor is what it is and not to lower it. Folded into the peer commit rather
than shipped as a follow-up.

### Gates, and a CI failure that was two different failures

Exit codes read by hand, not taken from a report: `make build` 0, `bun run pre` 0, `bun test`
**1669 pass / 0 fail** across 83 files (1668 + the one new regression test), `pack-test` 0,
`oxlint apps/playground/src` 0, playground typecheck 0.

The branch's CI failed twice, for two unrelated reasons, and only the first was diagnosed in the
handover:

1. **`@tanstack/react-table` 9.0.0, published the same day.** `pack-test.sh` installed the scratch
   consumer with an open-ended `>=8` while the declared peer is `>=8 <9`; v9 dropped the
   `getCoreRowModel` export and the export-surface snapshot died on it. Fixed by pinning the
   consumer inside the ranges it declares.
2. **`bun pm pack` non-deterministically omitted `configs/oxlint.json` from the tarball.** Re-running
   the _identical_ commit passed. Same bun 1.3.14 in both runs and locally; the file is tracked,
   unignored, and inside `files`; no code delta could touch tarball contents. Given the assertion
   order it was most likely the whole `configs/` directory.

The second is worth keeping in view but is not a supply risk: the real publish path is
`npm publish --access public` (`.github/workflows/publish.yml:56`), which uses npm's packer, not
bun's. It is a CI-gate reliability problem — and a reminder that **a gate can fail for a reason that
has nothing to do with the change under test**, which is exactly when a tired reader force-merges.

### B4 closed — 1.13.0 published, and the round-trip found three sites nobody had counted

`basalt-ui` **1.13.0** is published. The published tarball was checked rather than assumed, given the
packer flake above: all nine `configs/` files present including `configs/oxlint.json` (the preset
every consumer extends), the peer range shipping as `>=3.13.26 <4`, and 52 `dist/agent-chat/` files.
The publish path is npm's packer, so the bun flake never reached it.

Argo consumes it on `master` (`f354032`). `minimumReleaseAgeExcludes = ["basalt-ui"]` in the global
bunfig meant the 3-day supply-chain cooldown did not have to be bypassed — the first-party exemption
exists for exactly this.

**The guard promotion breaks nine sites, not six.** The handover predicted four raw scroll
containers plus the two agent rules in `chat-conversation.tsx`. All six were exactly where it said.
What it did not carry is that **`ai-sdk-major` was promoted too**, and it fires three times in
`apps/api` — `routes/hermes.ts:4`, `routes/hermes.ts:13`, `db/schema.ts:13`.

Those three are a different kind of finding from the other six, and the distinction is the whole
point of writing them down in code:

- The dashboard pair is **debt with an end date**. Their comments name **A3** as the removal point,
  so the migration has a checkpoint that a later reader can delete against.
- The `apps/api` three are **not debt at all** — they are locked decision **D3**, which keeps
  `apps/api` on `ai@5` permanently and neutralizes the skew producer-side in A1 with a
  `TransformStream` rewriting `finishReason: 'unknown'` → `'other'`. A bare suppression there would
  read as "someone was lazy" and invite exactly the upgrade D3 exists to forbid, so each says so.

Two things worth carrying beyond this phase:

**`ai-sdk-major` has no type-only carve-out, and its sibling does.** `db/schema.ts:13` is
`import type { UIMessagePart, UIDataTypes, UITools } from 'ai'` — erased at build, incapable of
producing the runtime `Unknown chunk type` the rule's own message warns about. `agent-no-raw-usechat`
explicitly exempts type-only imports (it is a row in the spec's own fixture table). `ai-sdk-major`
appears to lack the equivalent. Not worth reopening a published release for — argo suppresses it
either way — but it belongs in a later minor.

**The allow-comment matcher reads the comment that carries the token, not the comment block.** A
four-line `//` comment whose first line held `basalt-agent-allow` did **not** suppress: each `//`
line is its own comment node, the matcher requires the _token-bearing_ one to end on the node's line
or the line directly above, and the token was three lines too early. Lint stayed red with a comment
that looked correct. Caught by re-running the gate rather than by reading the diff — the same lesson
this phase keeps re-learning, in its cheapest possible form. Keep these suppressions on one line.

Also corrected during the convergence pass: the first attempt at the
`@ai-sdk/openai-compatible` comment said it sat "under the same locked major" as `ai@5`. It is
declared at `1.0.39` — major **1**. The rule fires there because the _package_ declares `ai@5`, not
because the provider shares that major. A wrong comment on a suppression is worse than no comment,
because the next reader trusts it.

**A1 is unblocked**, carrying the corrected premise from the prod walk: P1's "duplication is
render-only" verdict is true of the data and false of the wire.

## A1 — the API as a thin proxy

Four commits on `master`: `bb62fcd` (buildApp), `3cbcfc6` (usage attribution), `95bedc8` (SSE
backpressure), `e33c10e` (the proxy rewrite). Gates at close, exit codes read by hand: lint 0,
`format:check` 0, api typecheck 0, dashboard typecheck 0, dashboard build 0, `bun test:api`
**471 pass / 0 fail**, `check-theme` 0.

### The research gate confidently refuted the defect it was asked to confirm

Three research jobs ran before the brief. The AI SDK one came back `status: partial` and asserted
that `ai@5`'s `FinishReason` has six values with no `'unknown'` — i.e. that defect 1 does not exist,
and that the entire producer-side transform is unnecessary. It said so with high confidence, and it
noted in passing that "a separate sub-digest reported 7 values" before overruling it.

Read off disk instead:

| Package                                   | Values                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| `@ai-sdk/provider@2.0.3` (ai@5, apps/api) | 7 — **includes `'unknown'`** (`dist/index.d.ts:1081`)    |
| `ai@7.0.18` `uiMessageChunkSchema`        | 6, inside a `z.strictObject` (`dist/index.js:6395-6406`) |
| `@ai-sdk/openai-compatible@1.0.39`        | `default: return "unknown"` (`dist/index.mjs:171-172`)   |

The spec was right and the research was wrong. Two other resolved facts were load-bearing and would
have failed at runtime if taken from memory: `onConflictDoNothing` takes `{ target, where }` and has
no `targetWhere` (that is `onConflictDoUpdate` only), and **Postgres will not infer a partial unique
index unless the conflict target repeats its predicate** — an error `tsc` cannot see. Also that a
partial index's `.where()` must use a `sql` literal, because `eq()` makes drizzle-kit emit an
unsubstituted `$1` and Postgres fails with `42P02` (open since 2024, issues #2506/#3349/#4790).

The generalisation is now three-for-three across this program: **a negative result needs its
instrument verified at least as hard as a positive one.** B4 had an empty file that grepped clean;
B3 had one executed case producing a false clean; A1 had a research service confidently reporting an
absence. All three would have produced a wrong decision, and all three cost one command to refute.

### A migration that passed once and would fail forever after

The foundation lane's migration `ADD COLUMN` carried no `IF NOT EXISTS`, which breaks an invariant
`hermes.test.ts:13-14` states verbatim — "All Hermes migrations are fully idempotent (IF NOT EXISTS

- guarded FK)".

The failure is asymmetric, and that is why the lane missed it: the **first** run passes because it
adds the column, and every run after fails in `beforeAll` with `42701`. Worse, because that
`beforeAll` applies migrations through `client.unsafe` **outside** the drizzle journal, the journal
held 17 rows (0000–0016) while 0017's DDL was already in the database — so `runMigrations()` failed
too. Two lanes hit it from opposite directions within minutes: one booting the API, one running the
Hermes suite. Neither could fix it; it was not their file.

**Every hand-added migration in this repo must be idempotent**, because the test harness deliberately
applies them outside the journal. Proven by applying the file twice against the live DB: exit 0, all
three statements degrading to `NOTICE … skipping`.

### Two spec claims that did not survive the tree

Defect 17 says "No test in the repo imports the composed app at all." Three do — `jira.test.ts`,
`m365.test.ts` and `usage.test.ts` each imported `app` from `index.ts` as a **value**, so each ran
`runMigrations()` and opened a port merely to make a request. They now import the side-effect-free
factory.

Defect 20 says `recordAiUsage` "mis-attributes audio-gateway spend" by tagging it `billing='iu'`.
It does not. audio-gateway routes both STT and TTS through `IU_API_KEY`/`IU_OPENAI_BASE_URL`/
`IU_GEMINI_BASE_URL` (`config.ts:34-41`), tags itself `billing: "iu"` (`usage.ts:249`), and
modelpick's decision record says the same. The worker pushed back on its own brief with citations
rather than complying, and was right. The real adjacent defect is **double counting**: prod runs
`USAGE_SINK=both`, so a podcast synthesis writes two rows — the gateway's with real cost, Argo's with
`cost_usd` null. Cost does not double; tokens do. Johannes ruled: log it, do not fix it in A1. It
spans three repos and needs a decision on which source is authoritative. Recorded for A6.

The half of defect 20 that was real is closed: `billing`/`outcome` are overridable, and the error
paths that attempted an upstream call now write a row — previously a failure wrote **no row at all**,
so the `outcome` column was 100% `'ok'` by construction rather than by observation.

### The worst defect of the phase, and a worker that refused to hide it

The 409/CAS claim had a **100% reproducible** race. The order was: write the pointer (Postgres), write
the user turn (a second Postgres round trip), then register the stream with the durable backend —
which is what the liveness probe actually queries. A second POST landing in that window read the
pointer as set and the stream as not-live, classified it dead, and re-claimed it through the same CAS.
**Both POSTs returned 200.** The first run was orphaned: still generating, unreachable by stop or
resume. That is precisely the failure defect 5/6 exists to close, reached through a narrower door.

The test agent was briefed to assert "exactly one 200 and one 409". It found the assertion false 100%
of the time, **deleted the sub-test rather than assert something demonstrably wrong**, and reported
the race. Bending that test would have shipped the bug with a green suite and a comment saying it was
covered.

The fix is register-before-CAS, so pointer-visible and registry-knows become atomic from another
request's point of view — a happens-before, not a narrower window — plus a two-tier liveness check:
the in-process registry first, the pub/sub probe second, which keeps the stale-pointer case resolving
to "dead" so a crashed producer cannot wedge a thread forever. Reproduced (two 200s), fixed, then
20/20 on a loop.

### The review and the convergence pass disagreed on a severity, and the pessimist was right

Both found that `durable.register()` runs before an unguarded `await claimActiveStream(...)`, with
only the `!claimed` branch unregistering. Convergence judged it a bounded memory leak, reasoning that
no pointer ever references the orphaned id. That holds **only if the CAS never committed**. If it
commits server-side and the client await then rejects — a connection drop right after commit — the
pointer does reference it, `has()` reports it live forever, and the thread 409s permanently.

Worth stating because the pattern repeats: **a finding's severity can be wrong in the safe direction
too**, and "it is only a leak" is the kind of conclusion nobody re-checks.

### Implementing the spec exactly still left the defect open

Defect 4 prescribes four steps — read the client's `UIMessage.id`, add a nullable column, add a
partial unique index, `ON CONFLICT DO NOTHING`. All four landed exactly as written. Three review
angles independently found that those four steps dedupe the **row** and not the **turn**: once
`onFinish` clears the pointer, a retry carrying the same client id passes the CAS, silently no-ops the
duplicate user row, and **still invokes Hermes** — two replies, tool side effects re-run, upstream
billed twice.

It sits directly beside `maxRetries: 0`, which exists to stop exactly that. Johannes ruled: 409
`duplicate_turn` on a completed duplicate, and explicitly **no replay** — synthesising a stream from
persisted rows is real design surface that A2 may throw away.

Worth carrying: **a spec's prescribed fix can be complete and still not close the defect it names.**
The four steps were not wrong; they were the row-level half of a turn-level problem.

### A lane seam only EXPLAIN could show

`idx_hermes_thread_pinned_updated` could not serve the only query it exists for. Drizzle's `.desc()`
emits `DESC NULLS LAST` **in an index** but a bare `DESC` **in an orderBy** — and bare `DESC` in
Postgres means `NULLS FIRST`. The pathkeys never match, even though both columns are `NOT NULL`.

```
ORDER BY pinned DESC, updated_at DESC                        -> Seq Scan ... Disabled: true
ORDER BY pinned DESC NULLS LAST, updated_at DESC NULLS LAST  -> Index Scan using idx_hermes_thread_...
```

`Disabled: true` under `enable_seqscan = off` means no index path exists at all. One lane wrote the
index, another owned the query, both were individually correct, and no test can see it. The index was
pure write amplification on every turn. Fixed on the index side so the query stays natural, and
verified causally: after the fix the relationship **inverts** — the route's own query takes the Index
Scan and the `NULLS LAST` variant is the one that seq-scans.

The other confirmed convergence finding: the attachment-cap `422` **echoed the entire request body
back**, base64 payloads included, so rejecting a 40MB payload roughly doubled peak memory — inverting
the point of the cap. Now an 81-byte response for a 41.9MB request, with zero occurrences of the
payload in it.

### The browser gate found the one defect that no test, lint or review could see

Every gate was green, both blockers were closed, 471 tests passed. Then the gate agent read `git
status` before touching a browser.

The index was inconsistent. `git add -A` had run **before** the fix round regenerated the migration,
so the staged tree held `0017_windy_shen.sql` (the version with the broken index) while the real
`0017_nice_wilson_fisk.sql` sat untracked, the journal's 0017 entry was unstaged, and `hermes.ts`
showed ` M` — meaning a plain `git commit` would have shipped **none of the fix round's changes to the
main route file**, plus a journal with no 0017 entry at all. Prod would have created neither
`client_message_id` nor its index while the code read both unconditionally.

The agent executed the other half rather than inferring it: moving the migration aside and booting
gave `No file …0017_nice_wilson_fisk.sql found in …/drizzle folder` and nothing bound `:4040` — a
total boot failure, which on prod is a failed RollHook restart.

This is a new failure shape for this program. Every prior defect lived in the code; this one lived in
the **index**, and it was invisible to every gate precisely because gates read the worktree. The
countermeasure is cheap and now standing: **before committing, verify the staged tree, not the
working tree** — here, that every journal entry has a matching staged `.sql`. It came out 18 and 18.

### What the browser gate confirmed, with the dirty reading proven first

Eight scenarios against a self-launched Chrome on a dedicated debugging port with a throwaway profile,
raw CDP, and a local stub upstream chosen over the reachable real Hermes so chunk timing and
`finish_reason` could be controlled. The agent stated the URL, the app and its own server ancestry for
each observation, and found **two stale processes from the previous day still holding `:7715`** — the
exact hazard that made an earlier verification agent report findings about an unrelated project.

- **Reload mid-stream keeps the user's message.** The user row lands **9ms before the upstream call**.
  The new reply renders as a distinct bubble, not appended to the previous turn's.
- **A brand-new thread survives a mid-stream reload** — the empty-thread cleanup no longer deletes a
  thread whose first turn is in flight.
- **A second POST on a live stream returns 409, the first run is not reaped**, and the exchange leaves
  exactly two rows where production forensics had shown four.
- **`finish_reason: null` renders clean end to end**, with zero exceptions in the client's stream
  parser — and the **dirty reading was proven first**: rewriting `"other"` back to `"unknown"` in
  flight made the identical turn render "Something went wrong. Try sending again." A controlled A/B
  where only the enum value differed.
- **A duplicate completed turn returns `duplicate_turn` and the stub's invocation count does not
  move** — counted at the upstream, not inferred from the response.
- **Collapse-and-re-expand duplicates the rendered bubble but not the data.** One POST, one resume
  GET, DB holds a single clean row, and a fresh load shows the text once. Render-only, cosmetic until
  reload — which sharpens P1's verdict a third time rather than contradicting it.
- **The two things static review could not settle both came back clean.** An oversize body gets a bare
  413 with an empty body, rejected before Elysia. And Valkey being unreachable at stream start does
  **not** wedge a thread: the turn completes, `active_stream_id` never sticks, later POSTs still
  succeed, and the 32 publisher errors are absorbed by the `.on('error')` handlers with zero unhandled
  rejections. Degradation is "loses resumability", not "wedges" — which is the answer the review
  flagged as its highest-value unknown.

### Deferred deliberately

The architect angle escalated a refactor rather than acting on it: `POST /chat` is now ~285 lines in a
1234-line file with five stateful unexported helpers, so the CAS and liveness logic can only be
exercised through full HTTP round-trips. Johannes ruled **defer to A2**, which rewrites this transport
anyway and will know the right seams.

**D10 is confirmed** — A2 proceeds. Tool visibility gets fixed at the source rather than faked in the
renderer, and Argo will always send an explicit `X-Hermes-Session-Id`, closing the collision where two
threads both opening with "hi" share one session and one sandbox directory.

## A2 — the named-event transport

A1 shipped to production first: `dc201e2..3d04c3f`, RollHook rebuilt, both containers healthy on that
SHA. Migration 0017 verified against the prod database rather than assumed — `client_message_id`
present, `uq_hermes_message_thread_client_id` carrying the correct
`WHERE client_message_id IS NOT NULL` predicate, and `idx_hermes_thread_pinned_updated` emitting bare
`DESC` so its pathkeys match the route's own `ORDER BY`.

### The research gate was refuted by one HTTP request

The four-way survey converged on a brief whose top-ranked risk read: `tool.completed` carries no tool
id, no result and no error flag; `tool.failed` is never emitted; therefore Argo gets tool name plus
arguments and nothing else, tool success and failure are indistinguishable, and completions must be
correlated FIFO-by-name. It recommended shipping that as a documented limitation of D10.

Every clause of that is true about `tool.completed`. The conclusion drawn from it is false. A session
was created against the live gateway and one turn captured:

| Source                     | Carries                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool.started`             | `tool_name`, `preview`, full `args`                                                                                                         |
| `tool.completed`           | `tool_name` only — `preview` and `args` both `null`                                                                                         |
| `run.completed.messages[]` | real upstream ids (`toolu_vrtx_…`), `function.arguments`, and `role:'tool'` rows whose content is `{"output":…,"exit_code":0,"error":null}` |

Tool results, exit codes and errors were one payload away the whole time — at end-of-turn rather than
on the completion event. The FIFO scheme was designed around an absence that did not exist.

That is four phases running. B4 had an empty file that grepped clean; B3 had one executed case
producing a false clean; A1 had a research service confidently reporting an enum that was present;
A2 had a survey concluding data was absent when it was in the next event. **A negative result needs
its instrument verified at least as hard as a positive one** — and the cost of verifying is
consistently one command.

### Two things the capture settled that no amount of reading would have

`concat(assistant.delta) !== assistant.completed.content`. The deltas began `'\n\n31'` and the
content was `'31 items…'` — Hermes strips leading whitespace in the final content. The brief
prescribed asserting equality and logging a mismatch; that assertion would have fired on every
single turn, and the log would have been dismissed as noise within a day.

`tool.progress` with `tool_name: '_thinking'` carried a delta that was **verbatim the final reply**.
Mapping it to `reasoning-*` chunks — offered in the brief as the higher-value option — would render
the answer twice in every message.

### Defect 13 was confirmed by measurement, and it is wider than the register says

Production ClickHouse, `argo-api`, 30 days:

```
POST <hermes>/v1/chat/completions           Client  n=19  p50   25.9ms  max   57.9ms
POST /hermes/chat                           Server  n=19  p50   11.0ms  max   39.4ms
POST unified-endpoint…/openai/v1/chat/…     Client  n=30  p50 1410.2ms
```

The third row is the control: a non-streaming call through the same tracing code records its true
duration, so the instrument is sound and streaming specifically is blind. The register names only
`traced-fetch.ts`. But the **server** span is blind too — Elysia returns the `Response` and the body
streams after the handler span closes. Fixing the cited line alone would leave the turn invisible and
the gate would have looked green. _Brief a specific line and you get that line fixed._

The Hermes spans also carry zero domain attributes — no `thread_id`, `stream_id` or `run_id` anywhere
— so no per-stream query was possible at all. `streamId` was logged nowhere; `threadId` exactly once.

### D21 — the API bearer token is in the telemetry store

Found while establishing the trace lane, outside the 20-item register. `http.request.header.authorization`
is captured verbatim as a span attribute: **434,282 spans since 2026-07-07**, `uniqExact` = 1, i.e. the
live agent-facing key. Session cookies ride along at 400–520 bytes per span.

Stated accurately, because the severity matters: ClickHouse is not internet-exposed (clickstack
publishes only `:13133` on the tailnet). This is a credential at rest in an internal datastore and in
any backup of it — real, not an emergency. Fixed forward by scrubbing at the span-processor layer so
the defense survives an instrumentation change. **Rotating the token and purging the history are
owner decisions and were deliberately not taken**: rotation breaks Hermes and every agent holding the
key, and the purge is irreversible.

Two adjacent prod errors surfaced in the same sweep: `hermes summarize: malformed model JSON` ×15
against ~19 turns — the thread-title summarizer fails on essentially every conversation — and
`hermes transcript persist failed` ×1.

### The sideclaw otel worker is broken

`mcp__sideclaw__otel` exited 1 twice on different queries. ClickHouse itself was fine, which is the
distinction that mattered: the absence was in the instrument, not the data. The lane runs on direct
queries instead — `ssh vps "docker exec clickstack clickhouse-client --query …"` over
`default.otel_traces` / `default.otel_logs`.

### The review found four real defects and one that was not

`/review` returned `needs-human` with five blocking findings. Four were real and clustered in one
place — the turn-completion/abort state machine — so they were fixed as one coordinated change:

| Defect                                                    | Consequence if shipped                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finalize('aborted')` ignored the mapper's terminal state | A stop landing between `run.completed` and `done` persists a **completed** turn as `interrupted`                                                                        |
| The mapper was constructed _after_ the upstream call      | A stop during session-open emits no `abort` chunk at all, so the turn persists as `error`                                                                               |
| The `error` branch never called `closeOpenText`           | The documented shape is `error → done`; `done` sets `sawDone`, the route's `finalize` is gated on `!sawDone`, so a text part is persisted stuck in `state: 'streaming'` |
| `ensureHermesSession` never drains its 201 body           | With the tap defaulting on, every fresh thread held a span for the full 10-minute watchdog                                                                              |

The fifth was rejected. The adversary angle argued that a stream ending without `done` _after_
`run.completed` masks a failure as success and must be forced to an error. But `run.completed`
carries the full content **and** the usage totals, and `done` is emitted from a `finally` — its
absence there is a teardown drop, not a failed generation. Relabelling that turn `error` would
render a complete, correct reply as failed. The missing-`done`-is-an-error rule exists for the
silent-close case _before_ `run.completed`, which was already handled.

The span fix generalised into an inversion. Body-tapping had been made the **default**, which
silently reclassified every call site that never drains its body — the M365 fire-and-forget POST,
the Garmin heartbeat firing every sync tick, the Hermes health check reading only `res.ok`, and
`ensureHermesSession` on the hot path. Each held a span, a watchdog timer and a connection for ten
minutes before closing tagged `abandoned`. Making it **opt-in** (`streamLifecycle: true`) restored
all of them with zero edits to those files. Measured after the change:

```
POST …/api/sessions        6.8ms   (untapped, no argo.stream.* attributes)
POST …/chat/stream      19729.9ms   outcome=cancelled
hermes.stream-lifecycle 19728.4ms
```

### The browser gate was right about what it saw and wrong about why

Eight scenarios in a self-launched Chrome over raw CDP. Five clean. The headline finding was that
Stop appeared broken: `{"ok":true,"stopped":false}`, the turn persisted `complete`, and the stored
reply was 1244 characters where the user had watched 134.

Every one of those observations was accurate. The cause was not. A controlled reproduction against
a genuinely in-flight turn returns `stopped:true` and persists `interrupted` with partial text — and
after the fix round, the persisted text matches what the client received **exactly** (153 chars vs
153 chars, part state `done`, not `streaming`). What the gate actually hit is that **durable
streaming decouples the producer from the client connection**: the server had already finished
generating while the client was still rendering the buffer, so the pointer was clear and stop
honestly reported that there was nothing to abort. That is a client-side UX defect for A3 — made
worse by `stopHermesStream()` doing `.catch(() => undefined)` and never inspecting the body, so
`stopped:false` is swallowed by construction.

It also _strengthened_ the first review finding rather than contradicting it: because the server
routinely finishes ahead of the client, a stop landing at or after `run.completed` is the common
case, not a rare race.

### Three findings, three wrong premises

This is now the program's dominant failure mode — not missed defects, but correctly-observed
symptoms attributed to the wrong cause:

| Finding                                                        | Observation                                   | Actual cause                                   |
| -------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Survey: "tool results are unavailable, correlate FIFO-by-name" | `tool.completed` really does carry nothing    | The results were in `run.completed.messages[]` |
| Review: "missing `done` masks failure as success"              | The code really does not error there          | The turn genuinely completed                   |
| Browser gate: "stop is broken"                                 | Stop really did no-op and store the full text | The server had already finished                |

Each was careful and well-evidenced. Each would have produced a wrong change if the conclusion had
been actioned instead of the cause re-derived. **Verify the cause, not just the symptom** — the
symptom is usually real.

### An unrelated tree, and why nothing was staged with `-A`

Partway through, `wildrift.*` sources, a `0018` migration, and edits to `db/schema.ts`,
`cron/index.ts` and the drizzle journal appeared in the working tree — written between this phase's
own edits, by another session in the same checkout. A1's countermeasure ("verify the staged tree,
not the working tree") had a live target for the first time: every commit here stages **explicit
paths**, never `git add -A`.

## A3 — the dashboard rebuilt on basalt

Status at time of writing: implementation complete, seven-command gate green, two verification passes
run in a real browser, a third in flight. Not yet committed.

The demolition is real rather than cosmetic, and the cheapest proof is a grep: at `190d492`,
`git grep "from 'basalt-ui" -- apps/dashboard/src/features/hermes-chat` returns **zero** hits. The
working tree has **22 import sites across 13 files**. `transport.ts`, `message-markdown.tsx`,
`mermaid-diagram.tsx` and `message-markdown.module.css` are gone; `chat-conversation.tsx` went from
695 lines to 165; the net is about −1,000 lines.

### Three premises in the phase brief were false, and one of them would have cost the rebuild

The A3 scope list was written from the audit. Four of its claims did not survive contact with the code:

| Briefed                                        | Actual                                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Missing pending-guard" on new chat            | The guard **exists** (`chat-page.tsx:96`). The real bug: it rides async Query state, and `onSuccess` consumed the seed once but expanded **unconditionally**, so with two racing creates thread A got the seed and thread B got the expansion |
| `toUIMessages` discards `dynamic-tool` parts   | It **preserves** `row.parts` verbatim (`chat-view.tsx:21`). The discard was a layer later, in `messageText`'s `isTextUIPart` filter. **Fixing chat-view alone would have made no chips appear**                                               |
| Thread-list polls every 700ms–1s               | **No such poll exists anywhere in the client.** Nearest is a 1500ms×6 title poll gated behind `onFinish`                                                                                                                                      |
| Delete `transport.ts` and `diagram-shared.tsx` | Both have live importers on the _keep_ list — `apiBase` feeds three `voice/` files, and `vega-lite-diagram.tsx` imports both of `diagram-shared`'s exports                                                                                    |

The mermaid finding is the one worth keeping. Six stacked "Syntax error in text" blocks persisted in
the settled DOM with **no console error**, and it was not a React cleanup bug at all: `mermaid.render(id, src)`
called with **two** arguments makes mermaid append its scratch `<div>` to `document.body`, and the
parse-error path `throw`s the stashed exception **before** `removeTempElements()` runs. No amount of
React-side cleanup could have fixed it. It is moot now — the bespoke renderer is deleted and basalt's
path uses `beautiful-mermaid`, which throws into a `catch` that degrades to last-good-SVG then
`CodeBlock` — but a console-only check would have missed it forever.

### The spec's definition of done was wrong about the dependencies

`HERMES-CHAT-V2.md` says `react-markdown`, `remend`, `remark-gfm` and `mermaid` all leave
`apps/dashboard`'s direct dependencies. Three of the four are **basalt-ui's own optional peers** —
dropping them silently degrades basalt's `Markdown` to a plain-text renderer and skips the sanitize
pass. Only `mermaid` was droppable.

Johannes ruled: swap `mermaid@11.15.0` for `beautiful-mermaid@1.1.3` (what basalt's fence renderer
actually loads), keep the other three plus `remark-directive` and `rehype-sanitize`. All eight mermaid
diagrams in production are `flowchart TD`, which is squarely inside beautiful-mermaid's six supported
types. The spec text must be amended in A6 or the next reader will "restore" the wrong goal.

### The orchestrator's own ruling was the root cause of the phase's worst defects

The Postgres `ThreadsStoreAdapter` was specified with a **no-op write half** and `listThreads`
returning `messages: []`, reasoning that Argo's API already owns persistence. Both halves of that are
contract violations, and basalt's own shipped conformance suite says so at `adapter.ts:907`:

```
listThreads returned a STALE message list — a list started after a write resolves must reflect it
```

`createAdapterThreadsStore` fires a `revalidate()` proving load after every write and `prune()`s the
optimistic patch when the reload disagrees. Three defects followed, all confirmed in a real browser:

1. **The new-chat row was pruned mid-turn.** Measured: the proving `GET /hermes/threads` _responded at
   +69ms, seven milliseconds before `POST /hermes/chat` even fired at +76ms_ — so the server had not
   yet lazily created the thread. The feed showed "No threads yet" for the **entire turn** while the
   thread existed server-side with a full reply. A race, reproducing about one run in three.
2. **The user's own message was invisible for the whole turn**, deterministically — it lived only in a
   store the view deliberately never read, because not reading it was the workaround for the pruning.
3. **Resume after a mid-stream reload was dead**, a true regression: `HEAD` does it correctly with
   `useChat({resume: true})`. The `streaming` flag and `resumeToken` mapping added earlier in the
   phase were inert, because `useAgentThreadRuns`'s reconcile requires a last `role:'user'` message in
   `thread.messages` and the store's threads carried none.

The lane that built the adapter reported honestly that ten of thirteen conformance cases failed and
that every failure traced to the no-op design. That was read as "inapplicable by design" and waved
through. It was the framework saying the design was wrong. **The instrument was working; its reading
was discounted** — a new failure shape for this program, and the inverse of the four previous ones
where the instrument itself was at fault.

Johannes ruled: stop using `createAdapterThreadsStore` and implement basalt's `ThreadsStore` interface
directly over Argo's React Query cache. `useAgentThreadRuns` only ever required a `ThreadsStore`, so
everything already working — stop, tool chips, abort-on-unmount — was untouched.

### The fix for one heuristic became the cause of the next defect

The direct store fixed the prune race outright (`mergeServerThreads` only upserts by id; no code path
removes a locally-created thread) and restored resume by gating the mount of `useAgentThreadRuns` on
`hydrated` and eagerly fetching messages for the zero-or-one threads reporting `streaming: true`.

But its optimistic-message dedupe was **timestamp-based**: keep an overlay message while
`createdAt > dataUpdatedAt`. On an **existing** thread that worked (104 / 155 / 139ms to visible). On a
**brand-new** thread it was catastrophic — 23,149 / 31,973 / 25,046ms — because the messages query
404s on a thread that does not exist yet, and the `isNotFoundError` handler converts that 404 into a
**successful** `{data: [], total: 0}`, stamping `dataUpdatedAt` at the same instant the optimistic
message was appended. The guard against duplication became the cause of disappearance, and every
"start a new chat" hit it.

This was flagged as a residual risk _before_ the gate ran, on the grounds that the heuristic was
load-bearing on the unrelated global `refetchOnWindowFocus: false`. The gate proved it was not merely
fragile but actively broken.

The fix exposes `client_message_id` — a column phase A1 already added and already populates, simply
never surfaced in `MessageSchema` — and dedupes on the exact key.

### A brief that specified an impossible mechanism, and a worker that refused it

The fix brief instructed that the optimistic message's id "rides inside `messages[0].id`", which the
server reads via `readClientMessageId`. That is false, and the worker proved it:

- `useAgentThreadRuns.start()` mints `id: mintMessageId()` for the `ChatMessage` it appends to the
  store (`use-agent-thread-runs.ts:623`).
- `aiSdkTransport.stream()` mints a **separate, independent** `id: mintMessageId()` for the wire
  `UIMessage` (`ai-sdk-transport.ts:408`).
- `start()` passes only the raw input **string** to `transport.stream()` — the ChatMessage id never
  reaches the transport, and neither basalt internal exposes its id to the other.

Comparing them, exactly as briefed, would never have confirmed a user turn and would have rendered
every one **twice** — failing the acceptance criterion the same brief set. Because basalt is frozen,
the worker built the smallest correct bridge in Argo's own code: `hermesFetch` already rewrites the
outbound body, so it is the one seam that sees the real wire id, and it records it per thread in send
order.

That is the fourth worker in this program to refuse part of its brief with citations and be right.

### What the browser gates settled that no amount of reading would have

Two full passes, self-launched Chrome on dedicated ports with throwaway profiles, raw CDP, each agent
stating the URL, the app and its own server ancestry per observation.

Confirmed working and not to be re-litigated: **stop behaves exactly as ruled in both branches**
(`{stopped:true}` → partial text plus a "STOPPED" label; `{stopped:false}` → the full reply with no
label); **historical tool chips survive collapse and reopen** with real tool name, input and output,
closing defects 10 and 11; **secret redaction renders `[redacted]`** with zero real credential values
found; four rapid collapse/expand cycles mid-stream leave exactly one user and one assistant node with
each tool chip once; **zero console errors and zero `Runtime.exceptionThrown`**; no stray DOM nodes
outside the React root.

Two honest non-results, both reported rather than rounded up: the dedupe-vanish probe came back 2/3
clean and **1/3 inconclusive** because the harness reused a stale row reference and one send never
fired a POST; and console monitoring covered a representative combined pass rather than the entire
multi-hour session, which the gate stated plainly instead of claiming a clean session.

One false negative caught by the gate itself: the first 409 test found nothing, because opening a
second tab on an **already-streaming** thread correctly disables its composer so no request fires. The
real race needs tab B opened while the thread is **idle**, then raced. Re-run that way it produced the
expected 409 and the notification.

### Browser-gate knowledge specific to this machine, worth carrying

A windowed Chrome on the mini is unusable for this: there is no real display attached, `screencapture`
fails with "could not create image from display", and CDP `Page.enable` / `Page.navigate` hang
unpredictably — reproduced three times. `--headless=new` is reliable. Connect to the **browser**
endpoint and use `Target.attachToTarget({flatten: true})`; connecting directly to a page's
`devtoolsFrontendUrl` websocket leaves the target unresponsive to `Page.enable` after about two
reconnects.

### Two gate holes, one of them pre-existing

`apps/dashboard`'s test script was `bun test src/lib`, so **none** of the hermes-chat test files ran
under any gate — including the secret-redaction tests, the safety net for the credential leak. The gap
predates A3 (`smart-card.test.ts` dates to 2026-07-02) but A3 tripled what was being missed. Widened to
`bun test src`: 56 tests became 110.

`@ai-sdk/react` was left in `package.json` while completely unused. It is the exact package
`basalt/agent-no-raw-usechat` forbids importing from, so leaving it invites a future violation. Removed.

### Secrets — one finding in Argo, one upstream

The tool-event label persisted by the API is `event.preview ?? event.toolName`, where `preview` is
Hermes' own tool preview string — and a production row carries a shell command embedding a secret's
environment-variable **name**. Before A3 there was no client render path for it at all (zero
occurrences of `toolEvents` in the dashboard), so A3 was the change that would have started printing
it. Redaction is wired at render, and the browser gate confirms the DOM shows `[redacted]`.

The nuance the gate added: **the DOM is clean but the wire is not.** The raw
`GET /hermes/threads/:id/messages` response still carries the unredacted string, so Network tab, OTel
spans and any cached response see it. It is an env-var reference, not a resolved value. Argo-side
server redaction is queued for A6.

Upstream, and more interesting: `hermes-agent/config.yaml` had `security.redact_secrets: false` ten
lines above `security.secret_redaction: true` **in the same block**. Investigation against the runtime
source at `~/.hermes/hermes-agent/` (a full checkout; `~/SourceRoot/hermes-agent` is only the
config/skills repo symlinked into it) established:

- The runtime **default is `True`** (`config_defaults.py:2087`) — the config was explicitly overriding a
  safe default to off.
- Flipping it does **not** limit the agent. Redaction applies to tool **output**, never to the commands
  the model writes. Argument redaction was tried once (#19798) and reverted (#43083) precisely because
  the model read back its own `PGPASSWORD='***'` and copied the placeholder into the next turn.
- `secret_redaction` is **dead config** — zero references anywhere in the runtime, verified four
  differently-shaped ways. Almost certainly a word-order typo of `redact_secrets`, and the reason the
  block reads as "redaction is on" at a glance.

Flipped to `true`; Hermes was deliberately **not** restarted, so the running instance is unchanged
until Johannes chooses.

Johannes also asked whether Hermes could just take its secrets from the secrets cache. It already
does — `config.yaml:547-551` wires `secrets.command` to `secrets-run export --env-file=…`, resolved
once at startup into the process environment, which is what makes `$HOMELAB_API_KEY` references in
commands work at all under the `local` terminal backend. The variant where the **agent** resolves a
secret mid-task would be strictly worse: `secrets-run read op://…` prints the **value** to stdout,
which is persisted into the transcript, and the redactor is a vendor-prefix allowlist (`sk-`, `ghp_`,
`AKIA`, `xox…`) that matches none of Johannes's opaque self-issued keys. Tool-call arguments are never
redacted at all, and the repo's own `tests/test_download_guard.py:91` lists `secrets-run read op://…`
as an **allowed** command. The current env-var-reference scheme is leak-proof by construction; point-of-use
resolution would trade that for pattern matching that demonstrably fails on exactly these keys.

### The verification rounds, and what each instrument caught

Three browser gates and one adversarial code review ran over A3. They did not find the same things, and
the pattern of _which_ instrument caught _what_ is the useful part.

| Round  | Caught                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1 | The two structural blockers (thread pruned mid-turn; own message invisible) and the dead resume — none of which any test, lint or review had seen |
| Gate 2 | That the first fix worked for existing threads but made new threads **worse** — 23-32s, up from ~2s                                               |
| Review | Proved by execution that the overlay dedupe duplicates on reload/cross-tab/resume, **and cascades**                                               |
| Gate 3 | Independently observed both review findings in a live browser, and settled the dev double-GET against a production bundle                         |

The review and gate 3 agreeing, by completely different methods, on the same two defects is the
strongest signal this program has produced. The review executed `mergeOptimisticMessages` directly
against adversarial inputs; the gate drove a real browser and read the database. Neither saw the other's
work.

**The dev double-reconnect is StrictMode-only, now settled properly.** Gate 3 built the dashboard with
`VITE_API_URL`, served the bundle statically, and reached the API by disabling CORS in a _separate_
headless Chrome rather than editing the API's allowlist — settling the question without mutating the
thing under test. The production bundle fires exactly one reconnect GET. But the gate was careful to
add that the dedupe gap the double-GET _exposed_ is not StrictMode-dependent and recurs under any real
double-resume — so it was fixed on its own merits, not written off as a dev artifact.

**A false negative the gate caught on itself.** Its first 409 test found nothing, because opening a
second tab on an _already-streaming_ thread correctly disables that tab's composer, so no request is
ever issued. The real race needs tab B opened while the thread is idle and then raced. Re-run that way,
the 409 and its notification both appeared. A gate that had stopped at the first result would have
reported a passing check for a code path it never exercised.

**Honest non-results, recorded as such.** Gate 2's dedupe-vanish probe came back 2/3 clean and 1/3
**inconclusive** — its harness reused a stale row reference and one send never fired a POST — and it
said so rather than rounding up. Gate 2 also stated that its console monitoring covered a representative
combined pass rather than the entire multi-hour session. Both admissions are worth more than the clean
results around them.
