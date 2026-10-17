# Home (Today) — concept

Route `/` (shipped Wave 20; replaced the redirect in `apps/dashboard/src/routes/index.tsx`), source files to create: `apps/dashboard/src/routes/index.tsx`, `apps/dashboard/src/features/home/`. Reads existing endpoints only: Warden snapshot, Agents overview + history + narratives, Calendar (Google, M365, TickTick), Garmin recovery / training load, Warden item timelines.

## Baseline verdict

There is no page. `/` redirects to Garmin Health (`routes/index.tsx` → `navTarget(NAV, 'garmin')`), so opening Argo lands on one domain's charts. What the owner needs first — blocked work, the next meeting, today's body state — is spread over `agents--dark--desktop.png` (needs-you paragraphs), `warden--dark--desktop.png` ({n} decision rows) and `calendar--dark--desktop.png` (a 7×15 hour grid, almost all of it empty hour rows at 1440, an "All day" strip with {n} entries). The calendar shot is also the cleanest evidence of slop for agenda data: one-hour rows rendered for empty hours, week at 1,700 px tall.

**Distance from bar: 5.** The page does not exist; Keel's root (`root--dark--desktop.png`) is the target anatomy.

## The question and the decision

Question: what needs me right now, what is next on my day, and is my body and my fleet in a state to work?
Decision: act on the top decision card, or leave knowing nothing else is waiting.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| What needs me (merged) | One derivation, `apps/dashboard/src/lib/decisions.ts`, composing `lib/queries/warden` and `lib/queries/agents`: Warden `board.awaiting_owner` + `board.items` with state `failed`, Agents `humanQueue`, and agents with `state=needs_you`; each becomes `Decision {source, id, headline, facts, ageMs, actions}`, sorted by `ageMs` desc (the source's own clock: Warden `age_days`, human queue `askedAt`, agent `lastActivityAt`). The Home cards, the heading count, the summary sentence and the Agents/Warden `Needs you` sections all read this list (Agents and Warden filter it by `source`) | Request needing a decision | Two pages of tables and paragraphs | Up to 3 decision cards, ranked by wait; facts line starts with the source (`warden · <repo>` or `agent · <project>`) and age; same card anatomy as the two pages; `Show {n} more` row links to the pages | One inbox for two systems; the pages keep the long tail | `decision-card--dark--desktop.png` |
| Needs-you count | `decisions.length` from the same merged list as the cards (never `board.counts` or `summary.needsYou` directly, which would disagree with the cards) | Page's state in one sentence | n/a | Summary sentence plus the section count `Needs you {n}` | Count belongs to the heading (SPEC §8.4) | `root--dark--desktop.png` |
| Fleet pulse | Agents `summary`, `/history` 24 h | Status over time | n/a | Strip cell `AGENTS WORKING` `{n_working}` muted `of {n_agents}`, BandStrip 24 h under it | Shows whether the fleet ran overnight | `stat-strip--dark--desktop.png` |
| Loop health | Warden `health.pollers`, snapshot `receivedAt`, `budget` | Progress to a target | n/a | Strip cell `DISPATCH BUDGET · today` Meter `{used} / {max}` with max tick; qualifier `poller {age} min` | Budget is the one loop number worth a glance | `metric-card-bar--dark--desktop.png` |
| Next meeting | Calendar Google `/calendar`, M365 `/m365/calendar/upcoming`; first timed event with `start` > now | Single value with a target | n/a | Strip cell `NEXT MEETING · {time}` value `in {n} min` muted `<meeting>`; micro-timeline of today's remaining meetings as ticks on a 08–19 h axis | Time-to-next is the figure; ticks show the shape of the day | `metric-card--dark--desktop.png` (Next meeting cell in `root--dark--desktop.png`) |
| Today's meetings | same, filtered to today, plus `attendees.length`, `videoLink` | Event sequence | Hour grid with {n} empty rows | Agenda list (no grid): time column `{start} · {duration}`, title, `<n> people`, `Meet` chip when `videoLink`; past meetings muted; empty hours not drawn; all-day events as one chip row on top | Empty hours carry no information | `schedule-item--dark--desktop.png` |
| Tasks due | TickTick `overdue`, `dueSoon` | Part of a whole | Calendar legend entry | Single line `{n} overdue · {n} due soon` under the meetings, overdue count `status-bad` text | Two counts, one line | `activity-item--dark--desktop.png` |
| Recovery today | `/recovery` snapshot {recovery 0–100, components hrv/sleep/rhr, ceiling, strainDebt, penalty} + series | Progress to a target + trend | n/a | Strip cell `RECOVERY · today` value `<n>` muted `/100`, linear Meter 0–100 with a tick at the 7 d mean and the day's `ceiling`, sparkline 7 d with end dot | Recovery against its own baseline is the question | `metric-card-gauge--dark--desktop.png` |
| Training load | `/training-load` (ACWR, acute/chronic, zone) | Progress to a target (zone) | n/a | Strip cell `ACWR · 7 d / 28 d` value `{acwr}`, zone band under/optimal/over with marker | A number without a zone is not a reading | `metric-card-bar--dark--desktop.png` |
| Activity stream | Real fields only: Warden `snapshot.items[eventId].transitions` and `.dispatches` (timestamped rows; the snapshot carries the timelines the board's items reference), agent narratives (`/agents/narratives` `revisedAt` as the time, `summary` as the sentence), today's calendar events (`start`). **Not available:** agent state changes (`/history` carries only per-point `summary` counts) and calendar prep events (no route). Adding either is a prerequisite API change, not part of this concept | Event sequence | n/a | `Activity · Live` EventList (feed density), day groups, actor (`warden`, `narrator`, `calendar`), verb + entity (`<repo>` as chip), mono time right; newest first, up to 12 rows | One chronological feed from sources that exist; the `Live` pulse is shown only while the snapshot is under 30 min old | `activity-item--dark--desktop.png`, `timeline-event--dark--desktop.png` |

## Layout

1440, top to bottom:

1. Heading `Today` and summary sentence: `{n} items need you, oldest {age}. Next meeting in {n} min, recovery {recovery}/100.` Date on the right in mono.
2. Joined strip, 5 cells: Agents working (BandStrip) · Dispatch budget (meter) · Next meeting (ticks) · Recovery (meter + sparkline) · Training load (zone band). One row, no stacked tiles.
3. Two columns (≈ 60 / 40): left `Needs you {n}` decision cards (3 shown); right `Meetings {n}` agenda list over the tasks line, then `Activity · Live` EventList filling the remaining height.

All new; no current chart is reused. The Calendar page keeps its week/month grid for browsing; the agenda list here is a different shape of the same events.

390: summary sentence; strip becomes a two-column grid (5th cell full width); order is Needs you → Meetings → Activity; decision cards collapse the inset panel behind a disclosure; the activity feed shows 6 rows and a `Show {n} more` row.

## Copy

- Summary: `<n> items need you, oldest <age>. Next meeting in <m> min, recovery <r>/100.` With zero: `Nothing needs you. <w> of <total> agents working.` With no meeting: `No meetings today.`
- Section titles: `Needs you <n>`, `Meetings <n>`, `Activity` with a `Live` pulse and `<n> events today`.
- Strip captions: `AGENTS WORKING · 24 h`, `DISPATCH · today`, `NEXT MEETING`, `RECOVERY · today`, `ACWR · 7 d / 28 d`.
- Meeting rows: `<time> · <duration> min · <title> · <n> people`; placeholder in docs `<meeting>`.
- Activity rows: `Warden moved <repo> item to working`, `Agent <project> needs you`; time `{age}`.
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

## Wave 20 build notes

What shipped differs from the table above in these places, each on purpose:

- **Merged inbox.** `lib/decisions.ts` lists Warden `awaiting_owner` (already `needs_decision` + `failed`) plus any `failed` board item it missed, the Agents `humanQueue` and `needs_you` agents. The facts line reads `warden · {repo}`, `queue · {host}` or `agent · {project}`, then the age. The Agents and Warden pages still keep their own lists; they do not consume it yet.
- **Unavailable is not empty.** A source whose feed did not load is named in the sentence (`Nothing needs you (Warden unavailable).`), under the cards and in the empty state. A calendar feed that failed is named under the agenda.
- **Recovery cell.** The mean tick is the mean of the measured days in the last 7 of a 30 d window (the Garmin page's default, because recovery baselines are window-wide). The day's `ceiling` is not drawn: it is an activity score in MET-min, not a point on the 0–100 scale. Filed as a `Meter ticks` friction row.
- **ACWR cell.** Zones and cut-offs import from `features/garmin-health/model.ts`; the series is read over 90 d so the EWMA is warm.
- **Dispatch cell.** The budget Meter runs to 125 % of the cap with a tick at the cap; the poller age comes from `derivePollers`. A snapshot with no budget reads `Dispatch budget not reported by Warden`, the Warden page's own wording.
- **Meetings and tasks.** Google and M365 are read with `days=1` from today's local midnight (Calendar's `from`), so this morning's meetings come back and render as ended; a source that has not answered makes an empty day unknown, never `No meetings today`. Rows are the shared `ScheduleRow`. Tasks are TickTick `status = 0` with a due date before today (overdue) or within 7 days (due soon), read per project like the Calendar page.
- **Activity.** Warden transitions and dispatches, narrative `revisedAt` and today's started meetings, from the start of yesterday, newest first, 12 rows (6 at 390), `Live` only while every loaded feed (Warden, Agents) is under 30 min old; a stale one is named (`Stale: Agents 45m old`) and with no feed loaded there is no pulse (`No live feed`). The caption counts updates since yesterday, a burst on one item counting once.
- **Nav.** `Today` sits in a one-item `Overview` group at the top; it is not a mobile tab (the four tabs stay as they were), so on a phone it lives under More. Promote it to a tab if Today should be the phone landing page.

## Wave 20 rounds

Shots: `apps/dashboard/.design-shots/w20-home-r{1..6}` (gitignored). The weekend/empty live day has no meetings, so rounds 2–6 inject three synthetic placeholder meetings for the shot only (never committed).

- **r1** (own read vs Keel `root--dark--desktop`). Failed: breadcrumb and sidebar group both read `Today`; the activity rows split into three lines at 450 px (the container query fell to the narrow layout); three filled `Open in …` buttons spent the accent; ACWR footer repeated the zone; the recovery fill was near-white. Changed: group renamed `Overview`; one flowing sentence per feed row with an inline chip; the card action is the subtle secondary; footer names the optimal band; fill is `alpha(VX.muted, .5)`.
- **r2** (reviewer: summary, cards, show-more pass; strips, meetings, activity fail). Failed: `Activity` count (72) contradicted the 135-row list; axis labels collided at 390; heat strip showed no limit; `of 32` had no noun; overdue red below 4.5:1; durations in mono; sections without a period; meeting title truncated in its cell. Changed: header counts the whole window and group counts sum to it; 12 h ticks; intensity is share of the fleet (footer says so); `of 32 agents`; `VX.status.bad` for overdue; sans durations; `Meetings today`, `… events since yesterday`; title moved to the footer.
- **r3** (reviewer: strips partly pass). Failed: poller wording, `Section subtitle` renders as a hover-only icon (tooltips never gate data), durations still mono (they inherited it). Changed: the poller is named, the period moved into the visible title/header, `--basalt-font-sans` set on the duration.
- **r4–r5** (reviewer: meetings, meeting strip, cards, show-more pass). Remaining fails: `fontSizes` count in the agents/recovery/ACWR cells and the strip tooltip overflowing its cell at 390 are basalt-side (Meter's three caption sizes, chart chrome; filed in UPSTREAM); the sparkline has no hover value (basalt `Sparkline`); `recovery {r}/100` had no period, the group header was a bare count, the empty budget drew a decorative track. Changed: `recovery today {r}/100`, `Today · {n} events`, the empty budget is one muted line, no track.
- **r6** final shot of that state; no reviewer pass after the last three copy changes (they are the reviewer's own findings, applied verbatim).

Against Keel: same anatomy (summary, five-cell strip, decision cards left, agenda and feed right). Weaker than Keel: no greeting-scale heading (the shell breadcrumb names the page and basalt forbids an in-body title), the cards carry no source glyph or preview column, and feed rows are text only. All three are basalt-side or need data the endpoints do not carry.
- **r7** (lead feedback, then reviewer). Changed: a burst of steps on one Warden item (gap ≤ 10 min) is one feed row with its `from → to` path, dispatch result and a muted item-title line; the captions count updates and say a burst is one; the summary is an `h3`; decision cards carry the kicker above the question and the Warden state-history preview on the right (desktop); the heat strip is quieter and 28 px high; the recovery fill is quieter; the budget wording matches the Warden page, which reads the same `budget` field and is also unreported in the live snapshot. Reviewer, still failing: font-size counts and a 1 px `BandStrip` marker radius (basalt-side); the heading face draws a slashed zero in the summary (basalt heading font); rows wrap to two lines in a 40 % column; item titles are cut at one line by design; no hover affordance on the subtle card action. Added after the pass: a key on the next-meeting axis (`dot now · bars starts`).
- **r8** (real data, no injection; reviewer). Meetings now render the shared `ScheduleRow` over a read from today's local midnight, so ended meetings dim; an unanswered calendar is unknown. The live day is a weekend, so the agenda and next-meeting cells are empty, which the reviewer counted against density (two near-empty cells). Still failing: font-size counts and 10–11 px Meter/BandStrip text (basalt-side), the slashed zero in the heading face, the sparkline without a hover value, the agents band at near-uniform shade, colour-only warn on `waiting` ages, the subtle `Open in Warden` action, wrapped feed rows at 390. Not changed (scope frozen for review round 2).
- **r9** (post-deploy live score, reviewer). Changed: an empty day names the next meeting from a 7-day lookup (`Mon 10:45` in the strip, `None today · next Mon 10:45` in the card); stale ages carry the threshold in words (`stale ≥ 3 d`); the headline and the cards share `formatWaitDuration`; Meetings and Activity sit in the card surface. Verified by the reviewer. Still failing and left for the next round: the Needs-you heading sits outside a card while the right column's titles sit inside one (the reviewer would rather every heading sat outside); the strip countdown, the card state history and the feed use their own time formats; update counts (`60 since yesterday`, `29 today`) overlap; the Tasks line sits under a `Meetings today` title; feed rows wrap and truncate; the agents band, recovery sparkline and font-size counts (basalt-side).
