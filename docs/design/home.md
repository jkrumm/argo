# Home (Today) — concept

Route `/` (new, Wave 21; replaces the redirect in `apps/dashboard/src/routes/index.tsx`), source files to create: `apps/dashboard/src/routes/index.tsx`, `apps/dashboard/src/features/home/`. Reads existing endpoints only: Warden snapshot, Agents overview + history + narratives, Calendar (Google, M365, TickTick), Garmin recovery / training load, Warden item timelines.

## Baseline verdict

There is no page. `/` redirects to Garmin Health (`routes/index.tsx` → `navTarget(NAV, 'garmin')`), so opening Argo lands on one domain's charts. What the owner needs first — blocked work, the next meeting, today's body state — is spread over `agents--dark--desktop.png` (needs-you paragraphs), `warden--dark--desktop.png` (six decision rows) and `calendar--dark--desktop.png` (a 7×15 hour grid of which one cell is occupied; 13 empty hour rows at 1440, "All day" strip with two entries). The calendar shot is also the cleanest evidence of slop for agenda data: one-hour rows rendered for empty hours, week at 1,700 px tall.

**Distance from bar: 5.** The page does not exist; Keel's root (`root--dark--desktop.png`) is the target anatomy.

## The question and the decision

Question: what needs me right now, what is next on my day, and is my body and my fleet in a state to work?
Decision: act on the top decision card, or leave knowing nothing else is waiting.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| What needs me (merged) | One derivation, `apps/dashboard/src/lib/decisions.ts`, composing `lib/queries/warden` and `lib/queries/agents`: Warden `board.awaiting_owner` + `board.items` with state `failed`, Agents `humanQueue`, and agents with `state=needs_you`; each becomes `Decision {source, id, headline, facts, ageMs, actions}`, sorted by `ageMs` desc (the source's own clock: Warden `age_days`, human queue `askedAt`, agent `lastActivityAt`). The Home cards, the heading count, the summary sentence and the Agents/Warden `Needs you` sections all read this list (Agents and Warden filter it by `source`) | Request needing a decision | Two pages of tables and paragraphs | Up to 3 decision cards, ranked by wait; facts line starts with the source (`warden · <repo>` or `agent · <project>`) and age; same card anatomy as the two pages; `Show 7 more` row links to the pages | One inbox for two systems; the pages keep the long tail | `decision-card--dark--desktop.png` |
| Needs-you count | `decisions.length` from the same merged list as the cards (never `board.counts` or `summary.needsYou` directly, which would disagree with the cards) | Page's state in one sentence | n/a | Summary sentence plus the section count `Needs you 9` | Count belongs to the heading (SPEC §8.4) | `root--dark--desktop.png` |
| Fleet pulse | Agents `summary`, `/history` 24 h | Status over time | n/a | Strip cell `AGENTS WORKING` `11` muted `of 29`, BandStrip 24 h under it | Shows whether the fleet ran overnight | `stat-strip--dark--desktop.png` |
| Loop health | Warden `health.pollers`, snapshot `receivedAt`, `budget` | Progress to a target | n/a | Strip cell `DISPATCH BUDGET · today` Meter `12 / 20` with max tick; qualifier `poller 17 min` | Budget is the one loop number worth a glance | `metric-card-bar--dark--desktop.png` |
| Next meeting | Calendar Google `/calendar`, M365 `/m365/calendar/upcoming`; first timed event with `start` > now | Single value with a target | n/a | Strip cell `NEXT MEETING · 10:30` value `in 48 min` muted `<meeting>`; micro-timeline of today's remaining meetings as ticks on a 08–19 h axis | Time-to-next is the figure; ticks show the shape of the day | `metric-card--dark--desktop.png` (Next meeting cell in `root--dark--desktop.png`) |
| Today's meetings | same, filtered to today, plus `attendees.length`, `videoLink` | Event sequence | Hour grid with 13 empty rows | Agenda list (no grid): time column `10:00 · 45 m`, title, `<n> people`, `Meet` chip when `videoLink`; past meetings muted; empty hours not drawn; all-day events as one chip row on top | Empty hours carry no information | `schedule-item--dark--desktop.png` |
| Tasks due | TickTick `overdue`, `dueSoon` | Part of a whole | Calendar legend entry | Single line `3 overdue · 5 due soon` under the meetings, overdue count `status-bad` text | Two counts, one line | `activity-item--dark--desktop.png` |
| Recovery today | `/recovery` snapshot {recovery 0–100, components hrv/sleep/rhr, ceiling, strainDebt, penalty} + series | Progress to a target + trend | n/a | Strip cell `RECOVERY · today` value `<n>` muted `/100`, linear Meter 0–100 with a tick at the 7 d mean and the day's `ceiling`, sparkline 7 d with end dot | Recovery against its own baseline is the question | `metric-card-gauge--dark--desktop.png` |
| Training load | `/training-load` (ACWR, acute/chronic, zone) | Progress to a target (zone) | n/a | Strip cell `ACWR · 7 d / 28 d` value `1.1`, zone band under/optimal/over with marker | A number without a zone is not a reading | `metric-card-bar--dark--desktop.png` |
| Activity stream | Real fields only: Warden `snapshot.items[eventId].transitions` and `.dispatches` (timestamped rows; the snapshot carries the timelines the board's items reference), agent narratives (`/agents/narratives` `revisedAt` as the time, `summary` as the sentence), today's calendar events (`start`). **Not available:** agent state changes (`/history` carries only per-point `summary` counts) and calendar prep events (no route). Adding either is a prerequisite API change, not part of this concept | Event sequence | n/a | `Activity · Live` EventList (feed density), day groups, actor (`warden`, `narrator`, `calendar`), verb + entity (`<repo>` as chip), mono time right; newest first, up to 12 rows | One chronological feed from sources that exist; the `Live` pulse is shown only while the snapshot is under 30 min old | `activity-item--dark--desktop.png`, `timeline-event--dark--desktop.png` |

## Layout

1440, top to bottom:
1. Heading `Today` and summary sentence: `9 items need you, oldest 3.4 d. Next meeting in 48 min, recovery 72/100.` Date on the right in mono.
2. Joined strip, 5 cells: Agents working (BandStrip) · Dispatch budget (meter) · Next meeting (ticks) · Recovery (meter + sparkline) · Training load (zone band). One row, no stacked tiles.
3. Two columns (≈ 60 / 40): left `Needs you 9` decision cards (3 shown); right `Meetings 3` agenda list over the tasks line, then `Activity · Live` EventList filling the remaining height.

All new; no current chart is reused. The Calendar page keeps its week/month grid for browsing; the agenda list here is a different shape of the same events.

390: summary sentence; strip becomes a two-column grid (5th cell full width); order is Needs you → Meetings → Activity; decision cards collapse the inset panel behind a disclosure; the activity feed shows 6 rows and a `Show 6 more` row.

## Copy

- Summary: `<n> items need you, oldest <age>. Next meeting in <m> min, recovery <r>/100.` With zero: `Nothing needs you. <w> of <total> agents working.` With no meeting: `No meetings today.`
- Section titles: `Needs you <n>`, `Meetings <n>`, `Activity` with a `Live` pulse and `<n> events today`.
- Strip captions: `AGENTS WORKING · 24 h`, `DISPATCH · today`, `NEXT MEETING`, `RECOVERY · today`, `ACWR · 7 d / 28 d`.
- Meeting rows: `<time> · <duration> min · <title> · <n> people`; placeholder in docs `<meeting>`.
- Activity rows: `Warden moved <repo> item to working`, `Agent <project> needs you`; time `2m`, `11m`.
- Empty stream: `No events since <time>.`

## Upstream candidates

| Pattern | Props sketch | Maps to |
|-|-|-|
| Merged inbox (decision card list with source facts) | `DecisionCard` ×N, `sourceChip` | SPEC §3 recipe; shared with agents/warden |
| EventList feed density + `Live` pulse | `EventList density="feed" live` | SPEC §4 `EventList`, `live` prop is new |
| Next-event cell (time-to-next + day ticks) | `StatCell {value, unit, ticks:[{at, label}], axis:[from,to]}` | New; Meter variant with point marks |
| Agenda list rows | `ScheduleList {rows:[{time, duration, title, meta, state}]}` | SPEC §4 lists "Schedule / agenda list" as not built (D10); first consumer argo — propose adopt |

## Pass criteria

1. `/` renders the Today page; no redirect to Garmin.
2. The summary sentence contains at least three live figures and matches the sections below it.
3. The Needs-you heading count equals the number of cards the merged list holds (before the 3-card cut) and the figure in the summary sentence; the list merges Warden, human-queue and `needs_you` agent items, sorted by age, each with source and age in the facts line, and links to the page for the remainder.
4. Meetings render as an agenda with no empty-hour rows; empty day says `No meetings today.`
5. The strip has five cells, each with unit and period in its caption and a visual (meter, ticks, band or sparkline); recovery shows its 7 d mean tick.
6. The activity stream is day-grouped with mono times and a `Live` indicator while the feed is fresh; it shows all available rows up to 12, and an empty state (`No events since <time>.`) when there are none; every row traces to a transition, dispatch, narrative or calendar field.
7. No meeting title, message text or repo task text appears in docs or committed fixtures.
8. At 390 the order is Needs you → Meetings → Activity with no horizontal scroll.
