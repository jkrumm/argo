# Agents — concept

Route `/agents` · `apps/dashboard/src/routes/agents.tsx`, `apps/dashboard/src/features/agents/` (`hero-stats`, `needs-you-section`, `agents-table`, `agent-card`, `narratives-section`, `model.ts`). API: `GET /agents/overview`, `/agents/overview/history?hours=`, `/agents/narratives`.

## Baseline verdict

Shots: `agents--dark--desktop.png`, crops `agents--dark--01-needs-you.png`, `-02-oldest-wait.png`, `-03-active.png`, `-04-card.png`.

- Three tiles ("Needs you {n}", "Oldest wait —", "Active {n_working}") show a bare figure over a "last 24 h" footer. The sparkline is a step line with no scale, so "Needs you {n}" sits above a trace that says it was non-zero earlier; nothing on the tile says what the peaks were (`01-needs-you`).
- "Needs you" is {n} paragraphs of raw ask text (each very long, with shell commands inline) under a grey "HUMAN QUEUE" badge. No entity facts, no age as a figure, no action. The list is the decision surface and reads as a log dump.
- "Agents {n_agents}" is a {n_agents}-row table (project, state, next, standing, last activity, source). "Next" and "Standing" are em-dashes in every row; the sub-line "No recommendation run yet — states are deterministic…" is narration. A table is used where a shape exists: the rows are mostly the same project repeated.
- "Narratives {n_narratives}" is {n_narratives} rows of a project name, one sentence, a relative time. Unranked, undated by day.
- Slop by verdict: bare-count tiles, a table of dashes, filler sub-line, status as grey badges for every state.

**Distance from bar: 4.** Content is rich and honest, but no data has a fitted encoding; Keel's crew page (`crew--dark--desktop.png`) is the exact analogue and argo has none of its anatomy.

## The question and the decision

Question: which agents are blocked on me, for how long, and is the rest of the fleet moving?
Decision: answer or dismiss the blocked ones now; otherwise nothing, and leave.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Needs-you count | `snapshot.summary.needsYou`, `/history` points | Single value with a trend | Tile "{n}" + step sparkline | StatCard `value={n} unit="agents"`, caption `NEEDS YOU · now`, sparkline of `summary.needsYou` over 24 h with end dot, footer `peak {n} · {age} ago` | The trace shows whether zero is normal; the peak/age makes the line readable | `metric-card--dark--desktop.png` |
| Oldest wait | `agents[].lastActivityAt` where `state=needs_you` (the clock `oldestNeedsYouWait` and `isAbandonedWait` in `model.ts` already use; `humanQueue[].askedAt` ages its own cards but does not feed this tile) | Single value, threshold verdict | Tile "—" | Meter 0–7 d with a tick at the 24 h warn mark (`OLDEST_WAIT_WARN_MS`) and the 7 d abandon mark; value `{wait}`, caption `OLDEST WAIT · <project>`. Neutral fill; `status-warn` ink only past 24 h, `status-bad` past 7 d | The two thresholds already exist in `model.ts`; a bar with ticks shows distance to them | `metric-card-bar--dark--desktop.png` |
| Fleet by state | `summary` (needsYou, working, idle, stale, done; `dispatch` is excluded, see below) | Part of a whole, 2–6 parts | Tile "Active {n_working}" + text line "{n_idle} idle · {n_done} done · {n_stale} stale" | One segmented Meter, parts in fixed order working / needs you / idle / stale / done, count captions under segments, total = the sum of those five (`{n_agents} agents`). `summary.dispatch` counts `source === 'dispatch'` agents and overlaps working/done (`hero-stats.tsx` comment), so it is not a segment; it shows as a `dispatch {n}` source count in the project cards' SOURCE cell | Replaces tile + text line; compares the parts and shows the total | `metric-card-bar--dark--desktop.png` |
| Human queue | `humanQueue[]` {id, askedAt, question, cmd, host?} | Request needing a decision | Paragraph + code block + badge | Decision card: headline = first sentence of `question`, facts line `<host> · asked {age} ago` (clock: `askedAt`), inset panel = `cmd` in mono (collapsed past 3 lines), one primary `Copy command` (clipboard, client-side), full ask behind one disclosure. No dismiss or answer: the payload has no write endpoint, the ask is answered through `ask-human.sh` elsewhere | The ask is the headline; the long body is evidence. Actions are deferred until agent-gateway exposes an answer API |
| Agents waiting on me | `agents[]` where `state=needs_you`: title, blocker / waitingFor / standing, paneId, lastActivityAt | Request needing a decision | Row of badge + title + dim line | Same card: headline `title`, facts `<project> · waiting {wait}` (clock: `lastActivityAt`), inset panel = `blocker ?? waitingFor`, primary `Copy pane id` when `paneId` is present, else no button. Past 7 d the card takes the `Abandoned` label (`isAbandonedWait`) | One card anatomy for both queues; the clock per card is its own source's | `decision-card--dark--desktop.png` |
| Agent roster | `flattenAgents` (`model.ts`) prefers the top-level `agents[]` when it is non-empty and otherwise reads `projects[].agents[]` (agent-gateway's most-urgent-first order, `project` filled from the parent); the roster takes whichever it returns, and `projects[].git` feeds the GIT cell. Fields: project, title, state, lastActivityAt, startedAt, source, recommendation, standing, blocker, confidence | Entity with facts | {n_agents}-row table | Group by `project`; one entity card per project with ≥1 `working`/`needs_you` agent: identity line (project, state chip), inner 2×2 strip: RUNNING `{n} agents` + age bars · LAST ACTIVITY `{age}` · SOURCE `herdr {n} · dispatch {n}` · GIT `+{ahead} / −{behind}, dirty` (from `projects[].git`), then a `Now <title>` line. Projects with no working or needs-you agent (idle, done, stale, unknown, dispatch-only) collapse to one `BarList` row each: project, agent count, last activity, and a state chip for the worst state (`stale` takes `status-warn` text), so stale-only and dispatch-only projects are listed, not dropped | Table repeated one project {n} times; a card per project is {n_projects} cards, not {n_agents} rows | `crew--dark--desktop.png` |
| Agent activity over 24 h | `/history` points `summary.working` | Status over time | {n}-point sparkline in a tile | BandStrip 24 h, one cell per hour, intensity = working count; hour ticks every 6 h | Gaps and runs are the reading (feed stalls show as holes) | `stat-strip--dark--desktop.png` |
| Narratives | `/agents/narratives` {project, summary, page, revisedAt, updatedAt} | Event sequence | {n_narratives} flat rows | EventList keyed on `revisedAt` (when the prose last changed; `updatedAt` is the upsert time and is not shown), grouped by day: project as actor, `summary` as the sentence, mono time right, `page` as a link chip when non-null | Day groups give rhythm; sentence keeps the text | `activity-item--dark--desktop.png` |
| Feed age | `latest.receivedAt` (clock: snapshot age) | Single value, threshold | StaleBanner only when >30 min | Persistent `Live` pulse dot + `updated {age} ago` in the page summary; banner stays for >30 min | Freshness is a fact on every load | `timeline-event--dark--desktop.png` |

The Needs-you cards, their count and sort come from the shared merged-inbox derivation (`apps/dashboard/src/lib/decisions.ts`, specified in `home.md`); this page uses its agent-gateway subset (human queue + `needs_you` agents).

## Layout

1440, top to bottom:

1. Page summary sentence: `{n} items need you, oldest agent wait {wait}. {n_working} of {n_agents} agents working, {n_idle} projects idle.` (`{n} items` = `humanQueue` + `needs_you` agents, as the section count; `oldest agent wait` uses `lastActivityAt`; the 0-case reads `Nothing needs you. {n_working} of {n_agents} agents working.`).
2. Joined stat strip (`StatGroup variant="strip"`), 3 cells: Needs you (sparkline) · Oldest wait (meter) · Fleet by state (segmented meter). Replaces the three tiles.
3. `Needs you {n}` — decision cards (human-queue and agent kinds), one column, hidden when 0 (no empty section).
4. `Projects {n}` — entity cards in a 3-col grid, then the collapsed `BarList` of idle/done projects.
5. `Last 24 h` BandStrip, then `Narratives {n}` EventList (collapsed to 8 rows with a `Show {n_more} more` row).

Stays: the sync control in `PageBar`, `StaleBanner`. Changes: hero tiles, Needs you, roster. Goes: `AgentsTable` and its dash columns (`Next`, `Standing` return only when `recommendation`/`standing` are present on ≥1 agent).

390: strip stacks to one column of three cells; decision cards full width with the inset panel below the facts line; project cards one column; BarList and EventList unchanged; BandStrip keeps 24 cells.

## Copy

- Summary: `<n> items need you, oldest agent wait <wait>. <w> of <total> agents working, <i> projects idle.`
- Captions: `NEEDS YOU · now`, `OLDEST WAIT · <project>`, `FLEET · <total> agents`; sparkline footer `peak <n> · <age> ago`.
- Decision card: facts `<host> · asked <age> ago` (human queue) or `<project> · waiting <wait>` (agent), primary `Copy command` / `Copy pane id`; disclosure `Full ask · <n> chars`. No dismiss in v1.
- Project card: caption `RUNNING`, value `<n> agents`; line `Now <title>`; empty line `Idle · last activity <age> ago`.
- Sections: `Needs you <n>`, `Projects <n>`, `Last 24 h · agents working per hour`, `Narratives <n>`.
- Replaced: "No recommendation run yet — states are deterministic, next steps absent." → cut (shown only when `overview` is null as `Recommendations off · last run <age> ago`).
- Empty: `Nothing needs you — last ask answered <age> ago.`

## Upstream candidates

| Pattern | Props sketch | Maps to |
|-|-|-|
| Segmented state meter | `Meter segments=[{label,value,tone}] total unit captions` | SPEC §4 `Meter` `segments` |
| Entity card with 2×2 inner strip | `EntityCard {identity, status, cells: [4×{caption, value, unit, visual}], now}` | New; recipe in SPEC §6.9, not yet a component |
| Decision card | `DecisionCard {question, facts, evidence (slot), primary?, secondary?, quiet?, disclosure}`; actions optional so read-only cards are valid | SPEC §3 recipe; converge with warden and `rb` (D4) |
| Day-grouped feed | `EventList {groups, actor, verb, time}` | SPEC §4 `EventList` |

## Pass criteria

1. No hero tile shows a bare integer: each has unit, qualifier and a visual (sparkline, meter or segments).
2. The page summary sentence contains the needs-you count and the oldest wait as figures.
3. `Needs you` entries have a headline ≤ 90 characters, a facts line with age, at most one primary button (a copy action backed by a payload field, never a write), and the full ask behind a disclosure.
4. No table column is an all-dash column; the roster is grouped by project (≤ 12 cards for {n_agents} agents) and every project in `projects[]` appears as a card or a BarList row.
5. Fleet-by-state is one segmented bar of working / needs you / idle / stale / done whose captions sum to the stated total; `dispatch` is not a segment.
6. Narratives are day-grouped by `revisedAt` with mono times at the right edge; the sentence is the `summary` field.
7. At 390 nothing overflows and no row wraps; the strip is one column.
8. No coloured left edges; hue appears only on states `needs_you` / `stale` and wait thresholds.
