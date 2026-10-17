# Agents — concept

Route `/agents` · `apps/dashboard/src/routes/agents.tsx`, `apps/dashboard/src/features/agents/` (`hero-stats`, `needs-you-section`, `agents-table`, `agent-card`, `narratives-section`, `model.ts`). API: `GET /agents/overview`, `/agents/overview/history?hours=`, `/agents/narratives`.

## Baseline verdict

Shots: `agents--dark--desktop.png`, crops `agents--dark--01-needs-you.png`, `-02-oldest-wait.png`, `-03-active.png`, `-04-card.png`.

- Three tiles ("Needs you 0", "Oldest wait —", "Active 11") show a bare figure over a "last 24 h" footer. The sparkline is a step line with no scale, so "Needs you 0" sits above a trace that says it was non-zero three times; nothing on the tile says what the peaks were (`01-needs-you`).
- "Needs you" is three paragraphs of raw ask text (each 400+ characters, with shell commands inline) under a grey "HUMAN QUEUE" badge. No entity facts, no age as a figure, no action. The list is the decision surface and reads as a log dump.
- "Agents 29" is a 29-row table (project, state, next, standing, last activity, source). "Next" and "Standing" are em-dashes in every row; the sub-line "No recommendation run yet — states are deterministic…" is narration. A table is used where a shape exists: 29 rows are mostly the same project repeated.
- "Narratives 31" is 31 rows of a project name, one sentence, a relative time. Unranked, undated by day.
- Slop by verdict: bare-count tiles, a table of dashes, filler sub-line, status as grey badges for every state.

**Distance from bar: 4.** Content is rich and honest, but no data has a fitted encoding; Keel's crew page (`crew--dark--desktop.png`) is the exact analogue and argo has none of its anatomy.

## The question and the decision

Question: which agents are blocked on me, for how long, and is the rest of the fleet moving?
Decision: answer or dismiss the blocked ones now; otherwise nothing, and leave.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Needs-you count | `snapshot.summary.needsYou`, `/history` points | Single value with a trend | Tile "0" + step sparkline | StatCard `value=0 unit="agents"`, caption `NEEDS YOU · now`, sparkline of `summary.needsYou` over 24 h with end dot, footer `peak 2 · 3 h ago` | The trace shows whether 0 is normal; the peak/age makes the line readable | `metric-card--dark--desktop.png` |
| Oldest wait | `humanQueue[].askedAt`, `agents[].lastActivityAt` where `state=needs_you` | Single value, threshold verdict | Tile "—" | Meter 0–7 d with a tick at the 24 h warn mark (`OLDEST_WAIT_WARN_MS`) and the 7 d abandon mark; value `6h 12m`, caption `OLDEST WAIT · <project>`. Neutral fill; `status-warn` ink only past 24 h, `status-bad` past 7 d | The two thresholds already exist in `model.ts`; a bar with ticks shows distance to them | `metric-card-bar--dark--desktop.png` |
| Fleet by state | `summary` (needsYou, working, idle, stale, done, dispatch) | Part of a whole, 2–6 parts | Tile "Active 11" + text line "4 idle · 11 done · 1 stale" | One segmented Meter, parts in fixed order working / needs you / idle / stale / done, count captions under segments, total `29 agents` as value | Replaces tile + text line; compares the parts and shows the total | `metric-card-bar--dark--desktop.png` |
| Human queue | `humanQueue[]` {id, askedAt, question, cmd} | Request needing a decision | Paragraph + code block + badge | Decision card: headline = first sentence of `question` (title-case question form), facts line `<project> · asked 6h ago · 1 command`, inset panel = the `cmd` in mono (collapsed past 3 lines), one primary `Open pane`, quiet `Dismiss`; full text behind one disclosure | The ask is the headline; the 400-char body is evidence, not the surface | `decision-card--dark--desktop.png` |
| Agent roster | `agents[]` {project, title, state, lastActivityAt, startedAt, source, recommendation, standing, blocker, confidence} | Entity with facts | 29-row table | Group by `project`; one entity card per project with ≥1 `working`/`needs_you` agent: identity line (project, state chip), inner 2×2 strip: RUNNING `3 agents` + age bars · LAST ACTIVITY `4 min` · SOURCE `herdr 2 · dispatch 1` · GIT `+2 / −0, dirty` (from `projects[].git`), then a `Now <title>` line. Idle/done projects collapse to one `BarList` row each (project, count, last activity) | Table repeated one project 11 times; a card per project is 10 cards, not 29 rows | `crew--dark--desktop.png` |
| Agent activity over 24 h | `/history` points `summary.working` | Status over time | 11-point sparkline in a tile | BandStrip 24 h, one cell per hour, intensity = working count; hour ticks every 6 h | Gaps and runs are the reading (feed stalls show as holes) | `stat-strip--dark--desktop.png` |
| Narratives | `/narratives` {project, text, updatedAt} | Event sequence | 31 flat rows | EventList grouped by day: project as actor, sentence, mono time right | Day groups give rhythm; sentence keeps the text | `activity-item--dark--desktop.png` |
| Feed age | `latest.receivedAt` | Single value, threshold | StaleBanner only when >30 min | Persistent `Live` pulse dot + `updated 3 min ago` in the page summary; banner stays for >30 min | Freshness is a fact on every load | `timeline-event--dark--desktop.png` |

## Layout

1440, top to bottom:
1. Page summary sentence: `3 agents need you, oldest 6 h 12 m. 11 of 29 working, 2 projects idle.` (live numbers; the 0-case reads `Nothing needs you. 11 of 29 agents working.`).
2. Joined stat strip (`StatGroup variant="strip"`), 3 cells: Needs you (sparkline) · Oldest wait (meter) · Fleet by state (segmented meter). Replaces the three tiles.
3. `Needs you 3` — decision cards, one column, hidden when 0 (no empty section).
4. `Projects 10` — entity cards in a 3-col grid, then the collapsed `BarList` of idle/done projects.
5. `Last 24 h` BandStrip, then `Narratives 31` EventList (collapsed to 8 rows with a `Show 23 more` row).

Stays: the sync control in `PageBar`, `StaleBanner`. Changes: hero tiles, Needs you, roster. Goes: `AgentsTable` and its dash columns (`Next`, `Standing` return only when `recommendation`/`standing` are present on ≥1 agent).

390: strip stacks to one column of three cells; decision cards full width with the inset panel below the facts line; project cards one column; BarList and EventList unchanged; BandStrip keeps 24 cells.

## Copy

- Summary: `<n> agents need you, oldest <wait>. <w> of <total> working, <i> projects idle.`
- Captions: `NEEDS YOU · now`, `OLDEST WAIT · <project>`, `FLEET · <total> agents`; sparkline footer `peak <n> · <age> ago`.
- Decision card: facts `<project> · asked <age> ago`, primary `Open pane`, quiet `Dismiss`; disclosure `Full ask · <n> chars`.
- Project card: caption `RUNNING`, value `<n> agents`; line `Now <title>`; empty line `Idle · last activity <age> ago`.
- Sections: `Needs you <n>`, `Projects <n>`, `Last 24 h · agents working per hour`, `Narratives <n>`.
- Replaced: "No recommendation run yet — states are deterministic, next steps absent." → cut (shown only when `overview` is null as `Recommendations off · last run <age> ago`).
- Empty: `Nothing needs you — last ask answered <age> ago.`

## Upstream candidates

| Pattern | Props sketch | Maps to |
|-|-|-|
| Segmented state meter | `Meter segments=[{label,value,tone}] total unit captions` | SPEC §4 `Meter` `segments` |
| Entity card with 2×2 inner strip | `EntityCard {identity, status, cells: [4×{caption, value, unit, visual}], now}` | New; recipe in SPEC §6.9, not yet a component |
| Decision card | `DecisionCard {question, facts, evidence (slot), primary, secondary, quiet, disclosure}` | SPEC §3 recipe; converge with warden and `rb` (D4) |
| Day-grouped feed | `EventList {groups, actor, verb, time}` | SPEC §4 `EventList` |

## Pass criteria

1. No hero tile shows a bare integer: each has unit, qualifier and a visual (sparkline, meter or segments).
2. The page summary sentence contains the needs-you count and the oldest wait as figures.
3. `Needs you` entries have a headline ≤ 90 characters, a facts line with age, and exactly one primary button; the full ask is behind a disclosure.
4. No table column is an all-dash column; the roster is grouped by project (≤ 12 cards for 29 agents).
5. Fleet-by-state is one segmented bar whose segment captions sum to the total.
6. Narratives are day-grouped with mono times at the right edge.
7. At 390 nothing overflows and no row wraps; the strip is one column.
8. No coloured left edges; hue appears only on states `needs_you` / `stale` and wait thresholds.
