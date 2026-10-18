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

| Dataset                  | Source                                                                                                                                                                                                                                                                                                                                                                                                    | Shape (SPEC §3)                 | Today's encoding                                                                        | Chosen encoding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Reason                                                                                                             | Keel pattern                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Needs-you count          | `snapshot.summary.needsYou`, `/history` points                                                                                                                                                                                                                                                                                                                                                            | Single value with a trend       | Tile "{n}" + step sparkline                                                             | StatCard `value={n} unit="agents"`, caption `NEEDS YOU · now`, sparkline of `summary.needsYou` over 24 h with end dot, footer `peak {n} · {age} ago`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The trace shows whether zero is normal; the peak/age makes the line readable                                       | `metric-card--dark--desktop.png`     |
| Oldest wait              | `agents[].lastActivityAt` where `state=needs_you` (the clock `oldestNeedsYouWait` and `isAbandonedWait` in `model.ts` already use; `humanQueue[].askedAt` ages its own cards but does not feed this tile)                                                                                                                                                                                                 | Single value, threshold verdict | Tile "—"                                                                                | Meter 0–7 d with a tick at the 24 h warn mark (`OLDEST_WAIT_WARN_MS`) and the 7 d abandon mark; value `{wait}`, caption `OLDEST WAIT · <project>`. Neutral fill; `status-warn` ink only past 24 h, `status-bad` past 7 d                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The two thresholds already exist in `model.ts`; a bar with ticks shows distance to them                            | `metric-card-bar--dark--desktop.png` |
| Fleet by state           | `summary` (needsYou, working, idle, stale, done; `dispatch` is excluded, see below)                                                                                                                                                                                                                                                                                                                       | Part of a whole, 2–6 parts      | Tile "Active {n_working}" + text line "{n_idle} idle · {n_done} done · {n_stale} stale" | One segmented Meter, parts in fixed order working / needs you / idle / stale / done, count captions under segments, total = the sum of those five (`{n_agents} agents`). `summary.dispatch` counts `source === 'dispatch'` agents and overlaps working/done (`hero-stats.tsx` comment), so it is not a segment; it shows as a `dispatch {n}` source count in the project cards' SOURCE cell                                                                                                                                                                                                                                                                                                              | Replaces tile + text line; compares the parts and shows the total                                                  | `metric-card-bar--dark--desktop.png` |
| Human queue              | `humanQueue[]` {id, askedAt, question, cmd, host?}                                                                                                                                                                                                                                                                                                                                                        | Request needing a decision      | Paragraph + code block + badge                                                          | Decision card: headline = first sentence of `question`, facts line `<host> · asked {age} ago` (clock: `askedAt`), inset panel = `cmd` in mono (collapsed past 3 lines), one primary `Copy command` (clipboard, client-side), full ask behind one disclosure. No dismiss or answer: the payload has no write endpoint, the ask is answered through `ask-human.sh` elsewhere                                                                                                                                                                                                                                                                                                                               | The ask is the headline; the long body is evidence. Actions are deferred until agent-gateway exposes an answer API |
| Agents waiting on me     | `agents[]` where `state=needs_you`: title, blocker / waitingFor / standing, paneId, lastActivityAt                                                                                                                                                                                                                                                                                                        | Request needing a decision      | Row of badge + title + dim line                                                         | Same card: headline `title`, facts `<project> · waiting {wait}` (clock: `lastActivityAt`), inset panel = `blocker ?? waitingFor`, primary `Copy pane id` when `paneId` is present, else no button. Past 7 d the card takes the `Abandoned` label (`isAbandonedWait`)                                                                                                                                                                                                                                                                                                                                                                                                                                     | One card anatomy for both queues; the clock per card is its own source's                                           | `decision-card--dark--desktop.png`   |
| Agent roster             | `flattenAgents` (`model.ts`) prefers the top-level `agents[]` when it is non-empty and otherwise reads `projects[].agents[]` (agent-gateway's most-urgent-first order, `project` filled from the parent); the roster takes whichever it returns, and `projects[].git` feeds the GIT cell. Fields: project, title, state, lastActivityAt, startedAt, source, recommendation, standing, blocker, confidence | Entity with facts               | {n_agents}-row table                                                                    | Group by `project`; one entity card per project with ≥1 `working`/`needs_you` agent: identity line (project, state chip), inner two-column panel (one cell per reading, an odd trailing cell spans both): RUNNING `{n} agents` + age bars · LAST ACTIVITY `{age}` · SOURCE `herdr {n} · dispatch {n}` · GIT `+{ahead} / −{behind}, dirty` (from `projects[].git`), then a `Now <title>` line. Projects with no working or needs-you agent (idle, done, stale, unknown, dispatch-only) collapse to one `BarList` row each: project, agent count, last activity, and a state chip for the worst state (`stale` takes `status-warn` text), so stale-only and dispatch-only projects are listed, not dropped | Table repeated one project {n} times; a card per project is {n_projects} cards, not {n_agents} rows                | `crew--dark--desktop.png`            |
| Agent activity over 24 h | `/history` points `summary.working`                                                                                                                                                                                                                                                                                                                                                                       | Status over time                | {n}-point sparkline in a tile                                                           | BandStrip 24 h, one cell per hour, intensity = working count; hour ticks every 6 h                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gaps and runs are the reading (feed stalls show as holes)                                                          | `stat-strip--dark--desktop.png`      |
| Narratives               | `/agents/narratives` {project, summary, page, revisedAt, updatedAt}                                                                                                                                                                                                                                                                                                                                       | Event sequence                  | {n_narratives} flat rows                                                                | EventList keyed on `revisedAt` (when the prose last changed; `updatedAt` is the upsert time and is not shown), grouped by day: project as actor, `summary` as the sentence, mono time right, `page` as a link chip when non-null                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Day groups give rhythm; sentence keeps the text                                                                    | `activity-item--dark--desktop.png`   |
| Feed age                 | `latest.receivedAt` (clock: snapshot age)                                                                                                                                                                                                                                                                                                                                                                 | Single value, threshold         | StaleBanner only when >30 min                                                           | Persistent `Live` pulse dot + `updated {age} ago` in the page summary; banner stays for >30 min                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Freshness is a fact on every load                                                                                  | `timeline-event--dark--desktop.png`  |

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
- Decision card title: `Answer: <the ask's first sentence>?` / `Unblock agent: <task>?`, cut at a word; never the bare `Answer this request?` while the ask has text. The evidence line starts at the next sentence, never restating the title. Rule: `questionTitles` (`lib/question-copy.ts`).
- Headline with only asks waiting: `Requests are waiting for your answer, <n> with a command to run.` (the count is the tile's).
- Project card: caption `RUNNING`, value `<n> agents`; line `Now <title>`; empty line `Idle · last activity <age> ago`.
- Sections: `Needs you <n>`, `Projects <n>`, `Last 24 h · agents working per hour`, `Narratives <n>`.
- Replaced: "No recommendation run yet — states are deterministic, next steps absent." → cut (shown only when `overview` is null as `Recommendations off · last run <age> ago`).
- Empty: `Nothing needs you — last ask answered <age> ago.`

## Upstream candidates

| Pattern                                   | Props sketch                                                                                                                               | Maps to                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Segmented state meter                     | `Meter segments=[{label,value,tone}] total unit captions`                                                                                  | SPEC §4 `Meter` `segments`                         |
| Entity card with a two-column inner panel | `EntityCard {identity, status, cells: [{caption, value, unit, visual}, …], now}`                                                           | New; recipe in SPEC §6.9, not yet a component      |
| Decision card                             | `DecisionCard {question, facts, evidence (slot), primary?, secondary?, quiet?, disclosure}`; actions optional so read-only cards are valid | SPEC §3 recipe; converge with warden and `rb` (D4) |
| Day-grouped feed                          | `EventList {groups, actor, verb, time}`                                                                                                    | SPEC §4 `EventList`                                |

## Pass criteria

1. No hero tile shows a bare integer: each has unit, qualifier and a visual (sparkline, meter or segments).
2. The page summary sentence contains the needs-you count and the oldest wait as figures.
3. `Needs you` entries have a headline ≤ 90 characters, a facts line with age, at most one primary button (a copy action backed by a payload field, never a write), and the full ask behind a disclosure.
4. No table column is an all-dash column; the roster is grouped by project (≤ 12 cards for {n_agents} agents) and every project in `projects[]` appears as a card or a BarList row.
5. Fleet-by-state is one segmented bar of working / needs you / idle / stale / done whose captions sum to the stated total; `dispatch` is not a segment.
6. Narratives are day-grouped by `revisedAt` with mono times at the right edge; the sentence is the `summary` field.
7. At 390 nothing overflows and no row wraps; the strip is one column.
8. No coloured left edges; hue appears only on states `needs_you` / `stale` and wait thresholds.

## Wave 19 rounds

Shots are the gitignored `.design-shots/w19-agents-r<N>/`. The reviewer is `basalt-design-reviewer`; it had no `metrics.json` for the `make design-shot` harness, so every `[measured]` item scored `unverified` (counted as fail) and the verdicts below are the visual items only.

### Round 1 (fleet strip, project cards, BandStrip, narratives, summary; Needs you still the old list)

- Reviewer: the strip, cards, BarList, BandStrip and narratives all failed on at least one Craft/Expression/Communication item; the page itself passed. Top defects: the summary total ({n_summary} agents) disagreed with the strip total ({n_strip}); the fleet legend clipped its last caption; a zero segment carried a status hue; the oldest-wait cell was a bare dash with no ticks; the SOURCE cell truncated; the quiet `BarList` bars were full-width and encoded nothing; one band cell had an unexplained tint; narrative chips were long uppercase paths; relative times were German.
- Keel read: the crew card's four cells each carry a different micro-visual; ours were plain text, and the whole page read as stacked boxes of the same weight.
- Changed (round 2): summary total comes from the fleet parts; legend wraps and drops hue on zeros; BarList bars scale to the busiest project; `wiki page` chips replace path chips; SOURCE became a smaller value plus a share bar.

### Round 2–3

- Changed: oldest-wait meter always draws its 24 h tick and 7 d end caption (value `None · agents waiting` when no agent waits); the summary names `oldest ask` when only the human queue waits; the needs-you cell footer adds `+<n> in human queue` so `0 agents` and `<n> items` reconcile; git cell reads `in sync` / `↑a ↓b`; the band strip's caption only appears when an hour has no snapshot.

### Round 4

- Reviewer (r4): summary line, strip, BarList, BandStrip still failed individual items. Remaining defects: the oldest-wait cell as a bare dash against the summary's ask figure (fixed in r5 as above), SOURCE clipping on two-source cards (fixed: the cell wraps), idle and done segments close in tone (fixed: stepped strengths), orphaned `done` legend caption (fixed: zero parts leave the legend), BarList without a heading (fixed: `No agent running · <n> projects`), band caption narrating the UI (removed). The old Needs-you list failed pass criterion 3 as known-pending.

### Round 5–6

- Switched to the basalt-ui 2.18 `Meter` / `BarList`, then rebuilt Needs you on the shared `DecisionCard`: headline = first sentence of the ask (≤ 90 chars), facts `<host> · asked <age> ago` / `<project> · waiting <wait>`, the command or blocker as the mono `evidence` inset (clamped to three lines, `Show all`), `Copy command` / `Copy pane id` as the one primary, the full ask behind a `Full ask · <n> chars` disclosure, an `Abandoned` chip past 7 d. The card expressed every agents case; nothing was missing.

### Round 7 (first basalt `shot` round; metrics.json available)

- Reviewer: page passed; strip cells, project cards, decision cards failed on Craft 1/2 (off-scale paddings and nested radii inside the shared card, four type sizes), the oldest-wait cell was an empty meter beside a summary that named an ask age, the needs-you cell read `0 agents` against `3 items`, the lower sections were not anchored.
- Changed: `data-shot` anchors on every key surface; the oldest-wait cell falls back to the oldest human-queue ask (caption `Oldest wait · human queue`) when no agent waits, a deliberate deviation from the concept (which keeps `askedAt` off this tile) so the cell and the summary agree; needs-you footer carries the queue count; type scale tightened; age bars only with two or more running agents.

### Round 8–9

- Reviewer (r8): still failing on narratives (four type sizes, wrapped rows at 390), the oldest-wait cell's empty ratio, an orphaned `ago` in the needs-you footer, activity-strip tooltip redundancy. Changed: shorter footer, time column at the body size, the chip hidden at narrow widths, de-duplicated band tooltip.
- Reviewer (r9): oldest-wait, decision cards 1–2, project cards 2–6, quiet projects and the page passed. Remaining: fleet legend (four type sizes, idle and done one grey step apart), activity-strip focus tooltip over its heading, one truncated decision headline, narratives wrapping at 390, undefined `queued` / `peak` terms.

### Round 10

- Orchestrator read: the quiet-projects `BarList` had every value equal, so the bars carried nothing and were the loudest ink on the page. Replaced by a compact one-line list (name · agent count · state dot and label · mono age right).

### PR review round 1

- Null is never a measured zero: an absent or partial `summary` leaves the fleet, the summary clause and the oldest-wait cell as `—`; an all-null history leaves the activity peak as `—` (`fleetParts`, `peakWorking` return `null`). `unknown`-state agents ride as a sixth fleet part so the total matches the roster. The peak tie rule keeps the latest of equal peaks regardless of history order. Unexpected states count as `unknown`; `hourlyWorking` returns no buckets under one hour.
- Headlines end at the first sentence, or at the last clause boundary that fits (before a parenthesis, colon, dash, semicolon, comma), and ellipsize at a word boundary only without one. Project-card run times are labelled (`longest <age>`), the source caption states how many agents it counts, narrative sentences and quiet rows stay on one line at 390 (a pressed narrative sentence expands).
- Accessibility: the narratives list has real list/listitem roles with the `Show n more` button outside it, the command inset toggle is a button with `aria-expanded` / `aria-controls`, a failed copy reads `Copy failed`, strip cells carry explicit ids.
- Design rules applied (from the orchestrator's landscape study): (1) every encoding was re-checked against "is it even a chart": the needs-you tile stays a value with a trend, the fleet stays a part-of-whole meter, the quiet projects are a list, not bars; (2) the needs-you sparkline has no reference line (basalt `Sparkline` has none), so it is paired with a visible `peak n in 24 h` figure, and the gap is filed as friction; (3) the page has no deltas; its hero numerals use the mono face the DESIGN.md identity assigns to all numerals, which is tabular, a conflict with the proportional-figures rule filed as friction; (4) no value is hover-only: the activity strip states its peak hour and latest hour in text under the band, and a truncated narrative sentence expands on press. Polling refetches keep the previous data on screen (no skeleton), so no reduced-opacity state was added.

### Keel read (final)

Next to the crew card: the project cards carry the same anatomy (identity + state chip, two-column inner panel divided by hairlines, a `Now …` line); our cells are mostly text readings with two micro-visuals (age bars, source share), where Keel's carry a visual each. The decision cards sit closer to Keel's Needs-your-call cards than anything else on the page.

### Pass criteria

1. Holds. Needs you has value + unit + sparkline; oldest wait has a meter with the 24 h tick; fleet has segments.
2. Holds (the sentence carries the count and an oldest wait; the wait is the older of the oldest agent wait and the oldest ask).
3. Holds.
4. Holds: no table; every project is a card or a quiet-list row.
5. Holds: captions are the non-zero parts and sum to the total; `dispatch` is not a segment.
6. Holds at 1440. At 390 the page chip is hidden and the sentence wraps over two lines.
7. Partly: the strip is one column and nothing overflows horizontally, but narrative sentences and long decision headlines wrap at 390 (the reviewer counted that against "no row wraps").
8. Holds.

### Upstream (as built)

- `apps/dashboard/src/features/agents/stat-strip.tsx`: `StatStrip { label: string; cells: { caption: string; value: string; unit?: string; tone?: string; visual?: ReactNode; footer?: ReactNode }[] }`. Joined cells divided by 1 px hairlines; stacks to one column below an 800 px container.
- `apps/dashboard/src/features/agents/entity-card.tsx`: `EntityCard { identity: ReactNode; status: ReactNode; cells: [4 × { caption: string; value: string; unit?: string; small?: boolean; visual?: ReactNode }]; now?: ReactNode }`.
- `apps/dashboard/src/features/agents/status-chip.tsx`: `StatusChip { tone: 'neutral' | 'warn' | 'bad'; label: string }` plus `Dot { color: string }`.
- `apps/dashboard/src/features/agents/event-list.tsx`: `EventList { label: string; groups: { label: string; rows: { key; actor; title; chip?: ReactNode; time }[] }[]; limit?: number }` with a `Show n more` row past `limit`.

### basalt friction

- `Meter`: a second `ticks` entry. The oldest-wait meter wants ticks at the 24 h warn and 7 d abandon marks; only one `target` tick exists, so 7 d is the track end and its end caption.
- `Meter` with `segments`: no per-segment captions; the fleet legend is a local row under the meter.
- `BarList`: unsuitable when values tie; the quiet projects are a local row list instead.
- `DecisionCard`: the `evidence` inset (radius 4) nests a `pre` (radius 5) and the action buttons use off-scale paddings; both fail the Craft 1 scale checks.
- `Sparkline`: no hover value/time readout, and no reference (`reference?: number | 'mean'` or a target band) to qualify a tile sparkline.
- Hero numerals: the `StatCard`-style mono numerals are tabular; a `numerals: 'proportional'` prop is needed for a hero value.
- `BandStrip`: a text slot under the band and a legend for an intensity ramp.

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. needs-you tile showed 0 against a non-zero section; oldest-wait kicker and narratives truncated at 390; off-scale button inset (basalt).
- **Fixed between rounds (#86):** the tile counts exactly what the section renders (one rule), a shorter oldest-wait caption, two-line narratives at 390.
- **r2:** fail: the needs-you sparkline readout has no unit; the fleet cell is stretched half-empty (emptyRatio {r} ≥ 0.4); a decision-card title ellipsizes; the project-card mini bar has no caption; the activity-strip footer has no unit; the `Full ask` button inset is off-scale (basalt).
- **Against Keel:** does not hold up yet: no headline sentence, project cards half-empty, decision cards are code blocks with no evidence panel.
- **Open for Wave 24:** the five argo items above and a headline sentence.

### Wave 24 fixes

- Needs-you sparkline readout carries a unit (`{n} items`) via `format`; the footer drops the "line is …" encoding note.
- Fleet cell has a footer fact (non-working states with counts, `fleetFooter` + test) so it no longer stretches half-empty.
- Decision-card title: `headlineOf` keeps a clause-free sentence whole up to two lines before ellipsizing; an agent title that is still shortened gets the `Full ask` disclosure.
- Project-card run-time bars removed: the cell's unit already states the count and the longest run.
- Activity-strip footer states units (`peak {n} agents at {hh:mm} · latest hour {n} agents`); the amber note became a fact (`{n} hours without a snapshot`, `gapHours` + test).
- Headline: the local `page-summary.tsx` is deleted; the page uses the shared `PageSummary` (`summaryParts`: sentence = count + oldest wait, facts = fleet + idle projects, aside = `Live · updated {age}`).

No basalt gaps this round.

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the needs-you sparkline is a flat line with one spike (answers nothing); the fleet footer repeats the meter's own captions; the activity-strip footer restates its header; quiet-project ages clip at the right edge. Basalt: the `Full ask` button inset; `project-card-6` has no dark/390 metrics (harness).
- **Against Keel:** does not yet — decision titles are raw ask prose over a code block, with no facts or evidence panel; tiles are tall with dead space.

### Wave 25 fixes

- Needs-you cards open with a short question (`questionOf`, ≤80 chars, clause-aware); the full ask stays behind `Full ask`.
- Card facts: `{project} · waiting {duration} · {machine}` for agents, `human queue · {host} · asked {age}` for asks.
- One evidence line per agent card (`evidenceLine`: first blocker/waiting-for line, else `no blocker reported · snapshot {age}`); asks keep the command.
- Context preview on the right only when the agent's last reply adds to the evidence line (`previewOf`).
- Needs-you sparkline dropped; the footer is a fact with a unit and window (`waiting in {k} of 24 h`, or `of {observed} h observed` when snapshots are missing; `hoursWithNeedsYou`).
- Fleet footer is now the one fact the meter lacks, `longest run {duration}`, or `no agent working` (`fleetFact`).
- Activity-strip footer is `busiest hour {hh:mm} · agents working in {k} of 24 h` (`activityFact`; unmeasured hours leave the denominator and are named), no longer restating the header peak. The "shade is share" caption lives in `features/home/strip-cells.tsx` (not this page's file); left to the home owner.
- Quiet-project rows: wider age column, `auto` columns at narrow widths, so ages never clip.
- Project tiles: tighter cell padding; a project without git data keeps its Git cell as `—` (unknown, not zero); an odd trailing cell spans both columns.

No basalt gaps this round.

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail. Fixed: the flat needs-you sparkline is gone; the fleet footer no longer repeats the meter captions. Open: decision titles are still raw ask prose, one cut at an open bracket, none a question; one card has no action, two only `Copy command`; `Full ask · {n} chars` (a character count means nothing); quiet-project ages still clip at the right edge at 1440 and every row reads `1 agent` under a header saying none run; the activity heatmap has no legend and an unexplained empty last cell; `measured` vs `observed` across strips; the needs-you count has no status word and repeats the headline; project cards show a raw tool name.
- **Against Keel:** does not yet — Keel never shows a command block or a character count as decision content, and every card has a primary plus secondaries.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail. Fixed: no command block or character count as decision content; a secondary action on every card; quiet rows agree with the header; the heatmap has a legend and no unexplained last cell; one word for observed hours; the needs-you tile carries a status word. Carried: quiet-project ages clip at 1440; the needs-you count printed three times; raw tool name on project cards. **New:** the headline carries no figure; every card reads the same `Answer this request?` (the generic fallback names nothing); the heatmap legend says `darker = more` while dark scheme draws busier hours lighter. Unscored: the strip footer orphans an `h` at 390; the needs-you tile footer counts agents while the tile counts asks; `Idle`/`Unknown` undefined.
- **Against Keel:** does not yet — identical generic titles; Keel's question names the action and the object.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail. Fixed: cards no longer all read `Answer this request?`; the needs-you count once; no raw tool name; `Idle`/`Unknown` defined in the fleet legend; no wrong `darker = more` legend. Carried: the headline has no figure and restates the tile; quiet-project ages flush right at 1440, the `—` cut. **New:** the needs-you tile lost its footer and stretches (`emptyRatio` ≈ 0.6 at 1440, 0.54 at 390); each title restates its own evidence line (`Answer this request: {first words}?` over the same words), the prefix boilerplate on every card; one state with two names (`open, not working` in the legend, `Idle` in the quiet list); minutes as `m` (`{h} h {m} m`, `{h} h 0 m`) while other pages print `min`. Unscored: the fleet total twice in one cell (`{n} agents` / `of {n}`).
- **Against Keel:** does not yet — no figure in the headline, titles echo their evidence.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the needs-you count once; one name per state in the legend and the quiet list; minutes as `min`; the fleet total once; quiet-project ages whole and beside their state. Carried: the headline has no figure (`Requests are waiting for your answer.` restates the tile when only asks wait); the needs-you tile part-empty (`emptyRatio` 0.53 on 2.21.0 — basalt row); titles restate their evidence line (`Answer: {subject}?` over the same words). **New:** card 3 falls back to the generic `Answer this request?` (a regression of the w26 fix); the project card's running footer cut to `agents · longest {d} d {h}…` at 1440. Unscored: the activity-strip footer orphans `{n} h` at 390; its focus tooltip covers the heading (basalt); card 3 offers one action.
- **Against Keel:** does not yet — no figure in the headline, titles echo their evidence.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: titles no longer restate their evidence line; card 3 reads `Answer: {subject}?` instead of the generic fallback; the project card's running footer whole; the 390 activity-strip footer no longer orphans `h`. Partly fixed: the headline carries a figure, but it is the with-a-command sub-count, not the needs-you count or the oldest wait the concept asks for. Carried: the needs-you tile part-empty (`emptyRatio` 0.53 — basalt row); the activity-strip focus tooltip over the heading (basalt); card 3 offers one action. **New:** the running footer splits one duration across two lines (`{h} h` / `{m} min`). Unscored: `Answer:` above a `Copy command` / `Copy ask` primary — the verb does not match the button.
- **Against Keel:** does not yet — the headline's figure is not the one that matters; titles are `Answer:` plus the ask text.

### Wave 30 fixes

- **Compound durations whole** — fixed: `formatDuration` joins its parts with a no-break space, so the project card's running footer (`{h} h {m} min`) and the fleet cells never split between the parts; `ago` stays breakable.
- **Headline** — fixed: the with-a-command sub-count is gone: each card's primary button names it (`Copy command` vs `Copy ask`), so the count is the cards themselves and found nowhere new in a sentence; the sentence now ends with the oldest wait in the cards' spelling (`Oldest wait {d} d {h} h.`), omitted when no clock is reported. It is the strip's own figure (`oldestWait` in the model): the larger of the oldest agent wait and the oldest ask, named by its project or `the human queue`, so the headline and the cell cannot disagree.
- **`Answer: {subject}?` over a Copy primary** — fixed: the verb is the primary button's — `Copy command: {subject}?` when the ask carries a command, else `Copy ask: {subject}?`; an alert keeps its kind (`Copy ask on alert: {subject}?`); no subject reads `Copy ask for {host} request?`. Home keeps `Decide on …`. Updated rows in `__fixtures__/question-rung.ts`.
- **Title noise** — fixed for any ask or agent title: backticks unwrapped, a monitor's `[{monitor}]` prefix dropped.

### Wave 30 round (`w30-r1`, live after #122–#125 on basalt-ui 2.21.0)

- **Reviewer:** fail. Fixed: the headline ends with the oldest wait (the larger of agent wait and human-queue ask), the same figure as the oldest-wait tile; title verbs match the primary button (`Copy command: …?` / `Copy ask: …?`, an alert keeps its kind); the running footer keeps `{d} d {h} h` whole. Carried: card 3 offers one action; the needs-you tile part-empty (`emptyRatio` 0.53 — basalt row); the activity-strip focus tooltip over its heading (basalt). **New:** none argo-owned outside the frozen rung — `Copy command: {ask}?` reads as an instruction (recorded, not scored: the authored producer `question` is the owner's call). No lost fact: the with-a-command count is told by each card's button.
- **Against Keel:** close (was does not yet) — the headline carries the figure that matters; titles are still a prefix plus the ask text.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** every component passes; the page fails only on `craft-7/no-declared-states` (no anchor declares `data-shot-states`, so empty/loading/error went unrendered under basalt-ui 2.22's shot). Fixed: the needs-you cell is no longer part-empty (2.22 strip cells end at their content); decision-card titles keep identifiers whole at both widths. **New:** a project card's `{h} h {m} min ago` wraps with `ago` alone (data-dependent; `ago` is breakable by the w30 rule). Carried: card 3 offers one action; titles are a verb prefix plus the ask text (frozen rung). Unscored: the slashed zero in the headline (basalt); the 390 oldest-wait meter shows only its 24 h mark. No lost fact.
- **Against Keel:** close — Keel's cells each carry a micro-visual, ours are text readings.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail — every rest component passes; the new failures are the first-ever `empty` renders. Fixed: `craft-7/no-declared-states` (`empty` declared on `fleet-strip`, the real 404 → `latest: null` branch; history emptied with it, narratives stay live — another producer). **New (argo):** the empty activity strip says `No snapshot in the last 24 h` above `{n} hours without a snapshot` (two lines, one fact, read as a contradiction); the `No snapshot yet` alert names what has not arrived but no next step; the needs-you cell is a bare `—` with no reason line under `empty`. **New (basalt):** the alert's inline `Code` radius sits within 3 px of the Alert's (`craft-1/nested-radius-step`). Carried: card 3 offers one action; frozen titles; `{d} d {h} h` alone under `agents · longest` (polish). No lost fact.
- **Against Keel:** close — Keel's cells each carry a micro-visual, ours are text readings.

### Wave 33 fixes (round 12)

- **Empty state:** the `No snapshot yet` alert uses the shape shared with Warden — `agent-gateway pushes to {route} every 10 min from each dev host. If this stays empty, check that agent-gateway is running on a dev host.` The empty activity strip states the absence once (`No snapshot in the last {n} h`); the `{n} hours without a snapshot` line shows only beside a real fact. The needs-you cell reads `Waiting for the first snapshot` instead of a bare `—`.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail. Fixed: the `No snapshot yet` alert names the cause and the next step; the empty activity strip states the absence once; the needs-you and oldest-wait cells say `Waiting for the first snapshot` instead of `—` / a false `nothing waiting`. **New (argo):** the fleet cell under `empty` says `No fleet data in this snapshot` beside two `Waiting for the first snapshot` cells — two wordings for one gap, the second implying a snapshot exists. Unscored: the empty activity strip's legend still lists `None working`, which never appears. Carried (basalt): the activity strip's focus readout over its legend and footer; the Alert × `Code` nested radius. Carried: card 3's one action; frozen titles; a project card's value and unit on separate lines in dark 1440 (polish). No lost fact.
- **Against Keel:** close — Keel's cells each carry a micro-visual, ours are text readings.
