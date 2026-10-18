# Calendar — concept

Route `/calendar` (`?view=week|month&date=`) — `apps/dashboard/src/routes/calendar.tsx`, `features/calendar/calendar-page.tsx`, `lib/queries/calendar.ts`.

## Baseline verdict

- `calendar--dark--desktop.png` (week {week}): a 7 × 15 h `@mantine/schedule` grid, 1,500 px tall, holding **{n} all-day items**. Most of the surface is empty hour cells; the current-time line is the only live element. The all-day lane (72 px slot) truncates a title with an ellipsis.
- The legend (`{n_calendars}` `{calendar}` names, `Work (M365)`, `Tasks (TickTick)`) is `{n_sources}` same-weight dots in near-identical blues/oranges; the hues do not carry a trend or status, so they are categorical decoration (sky vs cerulean vs deep sky are not tellable apart).
- No sentence says what the week holds. The data the API returns and the page drops: attendees with response status (Google), `videoLink`, `location`, `bodyPreview`, `organizer`, TickTick `priority`.
- Mobile (`calendar--dark--mobile.png`) renders the same grid at 390 px: one column per day is unreadable, so the page is effectively a scroll of empty hours.
- Slop by the owner's verdict: empty-hour density, a legend instead of meaning, no number anywhere on the page.
- **Distance-from-bar: 5** — it is a generic grid widget with no summary, no agenda, no use of the fields that make a meeting actionable.

## The question and the decision

- Question on opening: what is on today, what is next and when, and how loaded is the rest of the week?
- Decision: join/prepare the next meeting, spot the longest free block to protect for focus work, and move or decline something on an overloaded day.

## Datasets and encodings

| Dataset              | Source                                                                                                                                                                                                                                                                                                                                      | Shape (SPEC §3)                  | Today's encoding                                              | Chosen encoding                                                                                                                                                                                                                                                                                                                                                                         | Reason                                                                                                               | Keel pattern                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Today's timed events | `GET /calendar`, `GET /m365/calendar/upcoming` (`start`, `end`, `title`, `calendarName`, `attendees`, `videoLink`, `location`)                                                                                                                                                                                                              | Event sequence                   | Blocks in a 15 h grid                                         | Agenda list, one row per event. At 1440 the time column is one mono line `{start} · {duration}` (start · duration); at 390 the duration drops under the start. Then title, source chip (`Work` for M365, `Personal` for every Google calendar), attendee count with accepted ratio (`{n}/{total} accepted`), `Join` icon-link when `videoLink`; the next event carries a pill `in {n}m` | Time at the left edge keeps the title column clean; the pill answers "when" without reading the clock                | `schedule-item`, `root` (Meetings {n}) |
| Day load             | Same events, summed per local day                                                                                                                                                                                                                                                                                                           | Status over time + bounded ratio | Not shown                                                     | 7-row strip card: weekday, bar on a shared 0–8 h track with a tick at 8 h, mono `{booked}` right-aligned, event count muted; today's row marked by a ring, not a fill                                                                                                                                                                                                                   | Length on a shared track ranks the days before any number is read                                                    | `metric-card-bar`, `stat-strip`        |
| Free time            | Gaps between events inside the 08:00–18:00 window (10 h)                                                                                                                                                                                                                                                                                    | Single value                     | Not shown                                                     | One cell: `{duration}` hero, caption `LONGEST FREE BLOCK · today`, muted `{start}–{end}`                                                                                                                                                                                                                                                                                                | The decision (protect focus time) needs one number and its window                                                    | `stat-cell`                            |
| Week by source       | Booked hours per source: M365 → Work, Google → Personal, set once at the query boundary: `mapCalendarEvent` in `lib/queries/calendar.ts` stamps `payload.sourceClass` (`'work'` / `'personal'`; TickTick has none) and every consumer reads that field. M365 events carry no `calendarName`; the Google `calendarName` stays muted row text | Part of whole, 2 parts           | `{n_sources}`-dot legend                                      | One segmented bar `Work {hours} \| Personal {hours}` with captions under the segments; hue only for these two categories                                                                                                                                                                                                                                                                | A categorical split earns two hues; calendar names move to muted text on the row                                     | `metric-card-bar` (segments)           |
| All-day events       | `isAllDay: true`                                                                                                                                                                                                                                                                                                                            | List of references               | 72 px lane, truncated                                         | Chip row above the agenda: `All day · {n}`, each chip full title, no truncation, wraps                                                                                                                                                                                                                                                                                                  | Full text beats an ellipsis in a lane                                                                                | `status-pill`                          |
| Tasks due            | `GET /ticktick/projects/{id}/data` (`dueDate`, `priority`, `status`)                                                                                                                                                                                                                                                                        | Status-dot list                  | Pushed into the week grid as all-day blocks with a flag glyph | Card `Tasks due · {n}`: status dot by TickTick priority (5 high `bad`, 3 medium `warn`, 0 none / 1 low neutral) plus a text label `High`/`Medium` in the meta (`Low` and none unlabeled), title, project muted, due date mono right                                                                                                                                                     | A task is not a time block; priority is a status, which earns the dot, and the label keeps it from being colour-only | `activity-item`                        |
| Week grid            | Same events                                                                                                                                                                                                                                                                                                                                 | Event sequence (spatial)         | Always 07:00–22:00                                            | Stays as the `Week` tab; window derived from **timed events only** (all-day items excluded): earliest start −1 h to latest end +1 h, clamped to 07:00–22:00; a week with no timed events falls back to 08:00–18:00                                                                                                                                                                      | A week with {n} all-day items stops rendering 15 empty hours                                                         | —                                      |
| Month grid           | Same events                                                                                                                                                                                                                                                                                                                                 | Status over time                 | Mantine `MonthView`                                           | Stays as the `Month` tab, unchanged                                                                                                                                                                                                                                                                                                                                                     | Day navigation tool; no redesign claim                                                                               | —                                      |
| Source errors        | query errors                                                                                                                                                                                                                                                                                                                                | Status                           | Yellow `Alert` per source                                     | One muted row in the summary line: `Google unavailable · re-authorize`, `—` in its figures                                                                                                                                                                                                                                                                                              | Failure is a state of the data, not a page banner                                                                    | `status-pill`                          |

## Layout

**1440.** Tabs `Agenda · Week · Month` and date navigation stay in `PageBar` (`Agenda` is the new default). Below, the summary sentence. Then a two-column grid (container query, 2:1):

- Left: `Today · {n}` agenda list, then `Next 7 days` day-grouped (`{weekday} {day}`; days with no events are one muted line `{weekday} {day} · free`), each group headed by its count and booked hours.
- Right: the week strip card (day load + the source segmented bar underneath), then `Longest free block` cell, then `Tasks due · {n}`.
- **One derivation module owns every computed number:** `apps/dashboard/src/features/calendar/derive.ts`, pure and React-free (unit-testable). It exports day load, booked hours (per day, week and `sourceClass`), the longest free block and the week window, and owns the constants `FREE_WINDOW` (08:00–18:00), `DAY_TARGET_H` (8), `WEEK_WINDOW_CLAMP` (07:00–22:00) and `WEEK_WINDOW_FALLBACK` (08:00–18:00). Components render its output and compute nothing.
- Today's all-day chip row heads the `Today` card, so the card's count reconciles with the list under it; other days carry theirs under the day heading.
- The legend is deleted. Charts: none new; the Week and Month grids stay as tabs.

**390.** Single column: summary, `Today` agenda (today's all-day chips head it), free-block cell, week strip card, `Next 7 days`, tasks. Rows do not wrap: duration moves under the time, the source chip drops into the muted meta line. The Week tab renders a 3-day window anchored on the selected `date` (± 1 day, so `Today` and the arrows move it); Month is a dot-per-day grid.

## Copy

Placeholders; the format is the contract.

- Page summary: `{n} events today, {booked} booked · next in {n} min · {hours} this week` (`, {booked} booked` is dropped when nothing timed is booked)
- Empty day: `No events today · 10h free`
- Section headings: `Today · {n}`, `Next 7 days · {n}`, `Tasks due · {n}`; the all-day chip row is labelled `All day` (the day's count lives in its header)
- Strip card title: `Booked hours, week {week}`; row `{weekday} {day}   {bar}   {booked}   · {n}`
- Cell caption: `LONGEST FREE BLOCK · today`; value `{duration}`; muted `{start}–{end}`
- Source bar captions: `Work {hours}`, `Personal {hours}`
- Row meta: `{duration} · <source> · {n}/{total} accepted`; pill `in {n}m`; link `Join`
- Task row: `<task> · <project> · due {weekday} {day}`
- Error: `Google unavailable — token expired. Re-authorize`
- Replaces: the legend; any "What's coming up?" style subtitle (none exists today, none is allowed).

## Upstream candidates

- `EventList` day-groups + time column (maps to SPEC §4 `EventList`). Props: `groups: { label, count, meta? }[]`, `items: { time, duration?, title, chips?, status?, trailing? }[]`, `now?: Date` for the pill.
- `Meter` row variant for the day strip (maps to `Meter`). Props: `value`, `max`, `tick?`, `caption`, `size="row"`.
- `ScheduleRow` (time/duration column + title + status pill + trailing action) — new; Keel's `schedule-item`. Props: `start`, `durationMin`, `title`, `meta`, `pill?`, `action?`. Used by Calendar and the home Today page.

## Pass criteria

1. The first screen at 1440 shows a summary sentence with at least three live numbers and the next meeting's countdown.
2. No empty hour region taller than 120 px on the Agenda tab; the Week tab's visible window is derived from the week's events.
3. Every agenda row shows `HH:MM · Nm` at 1440 (duration with its unit) and the duration under the start at 390.
4. The source legend is gone; hue appears only for the Work/Personal split.
5. The week strip's bars share one 0–8 h scale with a visible tick at 8 h and a mono hour value on each row.
6. Tasks appear as a dot list, not as grid blocks; High and Medium priority rows carry a text label next to the dot.
7. At 390 no row wraps and the Agenda tab needs no horizontal scroll.
8. No meeting title, person name or location appears in this doc or in any committed file.

## Wave 20 build notes

- **Past days.** `GET /calendar` and `GET /m365/calendar/upcoming` take an optional `from` (ISO date or datetime; default now, so agents are unaffected). The dashboard passes the local Monday of the week shown (`queryFromKey` in `derive.ts`), so Today lists the morning's meetings dimmed, the strip is the real Monday–Sunday week with today ringed, and the Week and Month grids show past events.
- **Row tick.** The shared track is 0–8 h with `max === target`, so the tick sits on the track end and a column header row names it (`target 8 h`) beside `booked` and `events`; a day over 8 h fills the track and turns `warn`.
- **Attendees.** `{accepted}/{total} accepted` up to 12 invitees, `{total} people` beyond: a ratio on a 100-person invite reads as noise.
- **Week at 390.** A day-grouped list of the 3-day window (selected ± 1) replaces the grid (no visible-days prop on `WeekView`, see UPSTREAM). The arrows move it 3 days.
- **Tasks.** Overdue or due within 7 days of today, from the same TickTick queries; the Week and Month grids carry meetings only.
- **Work / Personal hues** are registered series `calendarWork` (sky) and `calendarPersonal` (violet — no status or metric on the page uses it; gold would read as a warning).
- **One step per failure, on the failed surface (Wave 37).** A calendar failure is worded once: the headline carries `{sources} failed to load` (a still-loading source named beside a failed one), every card the same short form or `Loading`; the next step is one `Retry` action under the headline (accessible name `Retry calendar sources`), shown while a failed source a refetch can fix exists, and it refetches every such query. A sign-in failure (`Re-authorize`) is not a retry target; when every failed source is one, no `Retry` renders. Tasks keep their own sentence, `Tasks failed to load`, with `Retry` (`Retry tasks`) inside the card, refetching the reads `taskFeedState` counts as failed. There is no `— reload to retry` wording.
- **A day holding only live all-day items** states its count where the duration would be: `1 event · all day` / `2 events · all day`. **One event count (Wave 37):** every live, non-cancelled event, all-day included, tasks excluded, on every surface — day headers, the `Next 7 days` badge (the sum of its headers), the Today count, the summary sentence and the week strip's events cell. A day with timed events reads `{n} events · {booked}`; booked time stays timed-only. The chip row's label carries no count.
- Source errors read `{source} unavailable — {reason}` plus the sign-in step on the same line (Wave 37 round 16): Google a `Re-authorize` link, Microsoft 365 `Re-seed on the laptop: bun m365:auth:prod` with a `Copy command` action (`signInStep`; the Agenda headline and the Week/Month line both carry it; Retry stays hidden for either), and the failed source reads `unavailable` in the split; with the work feed down, personal hours are marked `(partial)` (personal is booked minus work, so it is a ceiling).

## Wave 20 rounds

Round log (placeholders only; shots under `apps/dashboard/.design-shots/w20-calendar-r{N}`, gitignored).

1. **r1** — reviewer failed all six components. Findings: the headline read `0m this week` beside a 7-day list with bookings (the feed then had no past days); `No events today` stated twice; day headers carried a bare count; day aggregates, strip values and due dates in mono; overdue dates showed a weekday that read as the future. Changed: a window and empty-day copy that r5 later replaced (the real Monday–Sunday week, `No events today · next {when}`), `{n} events · {booked}`, proportional values, `overdue · {d MMM}`.
2. **r2** — own read against Keel `root` / `schedule-item`: lists sat bare while the right column was cards; the pill read `in 44h`; the time column was too wide. Changed: Today and Next 7 days in cards, the pill only inside 12 h, time column 6.5 rem.
3. **r3** — reviewer passed summary, today and the page. Remaining: strip tick and per-day count unexplained, `Tasks due` unscoped, four font sizes in the list, truncated titles at 390, emoji in project names (data, not chrome), 1 px free-block gap and mono count chips (basalt prototype / `Section`). Changed: the strip caption named the tick and the count (replaced in r5 by a column header row), `Overdue or due within 7 days` under Tasks due.
4. **r4** — reviewer passed summary, today, free-block, tasks-due and the page. Failed: the split bar was one full-width blue segment when a class is 0 (hue separated nothing) — now drawn only when both classes have hours, captions always; next-days keeps four font sizes and truncated titles at 390 (the "rows do not wrap" criterion).

Open after r4, basalt-side: the free-block cell's 1 px gap and `Section`'s mono count chip (`StripCell` prototype and basalt `Section`); titles truncate at 390 by the "rows do not wrap" criterion.

## Wave 20 rounds — lead feedback, round 1

5. **r5** — API `from`, real week strip, shared `useNow`, registered series, a column-headed strip, `{total} people` on large invites. Verdict and criteria checks are in the PR thread. Shots were taken against production, which does not have `from` until this branch deploys, so past days stay empty in r5.

## Wave 20 review fixes

- **Unknown is a dash.** `agendaSummary`, `dayLoad` and `summarySentence` take the set of sources that have not answered (failed with nothing of the window cached, or still loading). Every figure that depends on one is `null` and renders `—`: the summary (`— events today · next — · — this week`), the free-block cell, each strip row and every day in Next 7 days (`—`, never `free`). A calendar's own split figure stays exact (`Work —` beside `Personal 3h`); the split bar is drawn only when both classes answered.
- **Phone Week window.** The queries start at the Monday of `date − 1` (`queryFromKey`), so the 3-day window keeps the Sunday before a Monday; the route's prefetch uses the same helper.
- **Split.** Work + Personal equals the booked total: a minute both calendars hold counts once, as Work.
- **One countdown wording.** `untilLabel` (`in 20m`, `in 1h 30m`) serves the pill and the summary; the pill shows under 12 h.
- **`from` validation.** A real calendar date (`2026-02-31` is a 422) and an explicit `Z` / `±hh:mm` offset on datetimes.

## Wave 20 live round

Post-deploy score on production failed four owner rules. Fixed: the strip's non-verdict fill is `alpha(VX.muted, 0.35)` (full-opacity `VX.muted` read near-white in dark; `status.warn` past 8 h stays); the free block's `now` rounds up to a whole minute so its length matches the printed `{start}–{end}`; the summary reads `{x} booked this week`; durations in the summary use a non-breaking space so `11h 5m` never wraps at 390 (applied in `summary.ts`, not the shared `formatDurationMin`, which this page does not own).

## Wave 23 rounds

Live production shots (`basalt-ui shot`, 1440 + 390, both schemes) after the basalt-ui 2.20.0 adoption (#81–#84), scored each round by a fresh `basalt-design-reviewer` plus a side-by-side against Keel. Boards: `.design-shots/w23-r1-*` and `w23-r2-*` (gitignored).

- **r1:** fail. cancelled M365 meetings looked live and were counted; tasks wrapped at 390; the next meeting was not named once today's had ended; four font sizes in next-days (basalt).
- **Fixed between rounds (#87):** cancelled meetings (title prefix) are muted, de-prefixed and out of every count, booked hour, free block and `next` (all-day included; `all cancelled` only for a wholly cancelled day); one-line tasks (superseded in Wave 26: titles wrap whole rather than cut mid-word); `next {day} {time} — {title}`.
- **r2:** fail, basalt-owned only: next-days still has four sizes (the list group label and meta are two small steps); the tall crop is blank below one screen (harness).
- **Against Keel:** mostly holds up; Keel's schedule rows carry a per-row state word, and its summary is a headline.
- **Open for Wave 24:** the API `isCancelled` field (the title prefix is a stopgap); a headline summary.

### Wave 24 fixes

- API: `isCancelled: boolean` on both event responses — Graph's `isCancelled` for M365 (added to the `get-calendar-view` `$select`; `false` when Graph omits it), `status === 'cancelled'` for Google. Tests: `clients/m365-calendar.test.ts` (`normalizeEvent`) and the OpenAPI check in `routes/calendar.test.ts`.
- Dashboard: `payload.isCancelled` (threaded in `mapCalendarEvent`) replaces the title-prefix stopgap in `derive.ts`; a `Canceled:` / `Cancelled:` / `Abgesagt:` prefix is still stripped from the displayed title, but a prefix alone no longer cancels a meeting, and a live meeting keeps its title as written. While the API image predates the field, the dashboard falls back to the prefix (`CANCELLED_TITLE` in `lib/queries/calendar.ts`).
- Headline: the summary in `agenda-view.tsx` is `PageSummary` — sentence `{n} events today, {booked} booked`, facts `next in {m}` and `{booked} booked this week` (`summaryParts`, tested); unknown sources read `Loading calendar` or the shared gap wording with dashed facts.

No new basalt rows.

### Wave 24 round (`w24-r1`, live after #90–#95)

- **Reviewer:** fail: the Today card repeats the headline's facts verbatim. Basalt: next-days still four sizes and ellipsized titles (list defaults); JetBrains Mono ligatures turn `<>` in a title into a diamond in the facts line.
- **Against Keel:** holds up — the week table and day-grouped agenda read as Keel; the Today card is a full-width block holding one repeated sentence.

### Wave 25 fixes

- The Today card renders only when there are events today. With none, the headline already says so and names the next event, so the card (a full-width block holding that sentence again) is gone and the column starts at Next 7 days. An unanswered calendar keeps the card as `—` (`todayCardState`, tested): no rows then is not no events.

No new basalt rows.

### Wave 25 round (`w25-r1`, live after #96–#101)

- **Reviewer:** fail. Fixed: no Today card repeating the headline. Open: the same defect moved — `Longest free block {h}` repeats the headline's free hours, the week strip's `Work {h}` repeats its booked hours, and the `8 h` column is an unexplained target; a task title cut mid-word at 1440; one task row has a coloured dot + priority word, the others grey dots with none. Basalt: next-days at 4 sizes; the next-days crop renders only its top half (harness).
- **Against Keel:** close.

### Wave 26 round (`w26-r1`, live after #102–#106)

- **Reviewer:** fail (no new defect). Fixed: no repeated free or booked hours; `target 8 h` names the tick; task titles wrap whole; every task row names its priority. Carried: next-days at four sizes and its crop cut (basalt / harness). Unscored: the facts line opens a wrapped line with `·` at 390 (basalt); long meeting titles ellipsize in next-days at 390.
- **Against Keel:** close — the headline has no figure in its sentence.

### Wave 27 round (`w27-r1`, live after #107–#111)

- **Reviewer:** fail (no new defect; the page renders as in w26). Carried: next-days at four sizes and its half-blank crop (basalt / harness); the `·`-led wrap at 390 (basalt); long meeting titles ellipsize in next-days at 390 (basalt `ScheduleRow` has no wrap option — the local CSS override was rejected in review). Unscored: a mono ligature turns `<>` in a title into a diamond (basalt); mobile next-days crops include the bottom nav (harness).
- **Against Keel:** close — the headline sentence carries no figure.

### Wave 28 round (`w28-r1`, live after #112–#116 on basalt-ui 2.21.0)

- **Reviewer:** fail (no new defect). Fixed: durations read `{h} h {m} min` (one spelling with Home and Agents). Carried: next-days at four sizes and its half-blank crop (basalt / harness); the `·`-led wrap at 390 (basalt); long titles ellipsize in next-days at 390 (basalt `ScheduleRow`). Unscored: the `<>` mono ligature (basalt); mobile next-days crops include the bottom nav (harness).
- **Against Keel:** close — the headline states a fact but carries no figure.

### Wave 29 round (`w29-r1`, live after #117–#121 on basalt-ui 2.21.0)

- **Reviewer:** fail (no argo change, no new defect). Carried (all basalt / harness): `ScheduleRow` at four sizes and its titles ellipsized at 390; the half-blank next-days crop; the `·`-led wrap; the mono `<>` ligature.
- **Against Keel:** close — the headline states a fact but carries no figure.

### Wave 30 round (`w30-r1`, live after #122–#125 on basalt-ui 2.21.0)

- **Reviewer:** fail (no argo change, no new defect). Carried (all basalt / harness): `ScheduleRow` at four sizes and its titles ellipsized at 390; the half-blank next-days crop; the `·`-led wrap at 390; the mono `<>` ligature. Compound durations stay whole everywhere.
- **Against Keel:** close — the headline states a fact but carries no figure.

### Wave 31 round (`w31-r1`, live after #129–#133 on basalt-ui 2.22.0; `w31-r2` after the follow-ups)

- **Reviewer:** fail. Fixed: no ellipsized titles at 390 (`ScheduleRow` clamps to two lines with the full title on hover); the `<>` ligature renders as typed (2.22); the next-days crop is whole; the `·`-led wrap is gone. **New (argo, `components/upstream/schedule-row.tsx`):** long titles now take two lines at 390 (the trade for no ellipsis); a cancelled row's compound duration drops under its start and runs into the meta column at 1440. Carried: `ScheduleRow` at four sizes (11/12/13/15). No lost fact.
- **Against Keel:** close — the headline states a fact but carries no figure.

### Wave 32 round (`w32-r1`, live after #134–#138 on basalt-ui 2.22.0, the first round with declared shot states)

- **Reviewer:** fail. Fixed: a cancelled row's compound duration sits whole under its start in the wider time column at 1440 (`ScheduleRow` drops the wide-row inline layout); `craft-7/no-declared-states` (empty / loading / error declared — the loader only prefetches, so production shows each card's own branch). **Not fixed (argo, `ScheduleRow`):** still four type sizes (11/12/13/15) in `next-days`. **New (argo, now visible because the states render):** `tasks-due` prints `0` and `Nothing due in the next 7 days` while loading or failed (a false zero — task fetch state is not tracked); `next-days` shows seven `{day} —` rows with no reason and loading looks the same as error; `Today` shows a lone `—`; the week strip and free block word loading as the error (`… unavailable`, `a calendar has not answered`). **New (basalt):** the week strip's `Meter` null caption prints `No data` under every day. Carried: long titles take two lines at 390 (the accepted trade for no ellipsis). No lost fact.
- **Against Keel:** close at rest (the headline still carries no figure); its failure states do not yet hold up.

### Wave 33 round (`w33-r1`, live after #139–#143 on basalt-ui 2.22.0)

- **Reviewer:** fail. Fixed: `tasks-due` has no false zero (`Loading tasks` / `Tasks failed to load — reload to retry`, replaced in Wave 37 by a `Retry` action); `Today` names the failed sources and the next step instead of a lone `—`; loading and error are worded apart in next-days, the week strip and the free block; next-days is at three type sizes. **New (argo):** next-days repeats `loading` on all seven day rows (one state line, not seven) and its error says `failed to load` ×7 with no source or action; the week strip's error footer `{source} failed to load · {source} failed to load` gives no next step — three wordings for one calendar failure across next-days, the week strip and Today; the week strip's empty rows are all zero with no reason line; `Loading calendar` text sits in three cards; `no events` and `no meetings` name one empty day two ways. Carried (basalt): the week strip `Meter` prints `No data` under every day while loading or failed. Carried (accepted): long titles take two lines at 390. No lost fact.
- **Against Keel:** does not yet — the failure states are not yet one wording per gap.

### Wave 34 round (`w34-r1`, live after #144–#147 on basalt-ui 2.22.0; `w34-r2` after #148)

- **Reviewer:** fail (basalt only — the week strip `Meter` `No data`). Fixed: next-days says loading / failure once per card, not per day row; one failure wording — the page headline carried `{sources} failed to load — reload to retry` once (Wave 37: a `Retry` action replaces the wording), every card `{sources} failed to load` (a still-loading source named beside a failed one) or `Loading`; the week strip's empty week says `Nothing booked this week in {sources}` (what the load measures — all-day and cancelled items book none); one term `no events`; a day holding only all-day items carried no head label (no false `no events`; Wave 37 gives it `{n} event(s) · all day`); no loading worded as error, no false zeros. Carried (argo, P2, allowed by the round rules): the per-card state line on four cards of one screen. Carried (accepted): long titles take two lines at 390. Unscored: the headline's `— reload to retry` has no loading / error page shot; next-days `empty` lists seven `no events` rows without naming the sources the week strip names; tasks-due `empty` `Nothing due in the next {n} days.` sits under an `overdue or due` scope. No lost fact (the step moved to the headline).
- **Against Keel:** close (was "does not yet") — one wording per gap; Keel still puts the action on the failed surface itself.

### Wave 35 round (`w35-r1`, live after #149–#151 on basalt-ui 2.22.0)

- **Reviewer:** fail (basalt P1 plus argo P3s). Untouched this wave; only the clock-driven free block differs from w34. The repeated-gap rule holds under `error` (cards carry only `{sources} failed to load`; the tasks source keeps its own sentence) and there are no false zeros. Carried (basalt): the week strip's `Meter` prints `No data` under loading / error. **New by the rule (argo, P3):** under `empty` one gap reads three ways — the headline `No events today`, seven `no events`, and `Nothing booked this week in {sources}` — with the full form on the third surface, not the leading one (a break only if the past week and the next seven days count as one gap: the next wave decides). Unscored (argo, P3): cards say `Loading` where a skeleton could stand (never worded as error); the free block's `today` does not state the working day's end. No lost fact.
- **Against Keel:** close — Keel puts the retry on the failed surface itself; ours puts the step in the headline only.
- **Re-score `w35-r2` (after basalt-ui 2.23.0, #152):** fail. Closed by 2.23: the week strip's `Meter` no longer prints `No data`; but its null reading is now a stray `—` under every empty track (new, basalt, P3 — three dashes per row and doubled row height under loading / error). **New (argo, P3, clock-driven):** after the working day the free block shows a dash beside `none left in {start}–{end}` — a measured zero that reads as unknown. Carried, first flagged now (argo, P1): at 390 dense agenda rows wrap their titles onto two or three lines. Argo P3s from `w35-r1` unchanged. No lost fact.

### Wave 36 round (`w36-r1`, live after #153–#155 on basalt-ui 2.23.0; `w36-r2` after #156–#158; `w36-r3` after #159)

- **Reviewer (`w36-r1`):** fail. Fixed (confirmed, #153): the free block shows a measured `0 min` beside `none left in {start}–{end}` after the working day (w35 P3, which also states the day's end); the day rows and week strip carry the short form `No events` under `empty` (the past week, today and the next 7 days are one gap — the headline carries the full sentence, unshot: no page-level `empty` anchor); agenda titles are one line with an ellipsis at 390 and 1440 (the w35 P1). Unscored before (argo, P1): the tasks-due rows wrapped a title onto two lines; (argo, P3) a single empty day read `no events` beside `No events`. Carried (argo, P2): `Loading` words where skeletons belong.
- **Re-score `w36-r2` (after #157):** fail. Confirmed: one-line task rows, one `No events` casing, skeletons under `loading`, an unknown Today never shows an event list. **New (argo, P1):** the Today skeleton was one bar in a full-height card (emptyRatio ~0.6).
- **Re-score `w36-r3` (after #159):** fail on the measurer only. Confirmed visually: Today, Next 7 days and Tasks each show skeleton rows shaped like their loaded rows (5 / 6 / 3, the phone 3-day list its own count), no card looks ≥ 40 % empty — but `emptyRatio` counts skeleton bars as empty space and reads 0.862 (basalt, UPSTREAM § "Wave 36"). Remaining (argo, P3): an all-day-only day header shows no `{n} events` fact; only the tasks card carries a step on failure. Carried (basalt): the `Meter` null `—` under week-strip tracks. No lost fact versus `w36-r2` or `w35-r2`.
- **Against Keel:** close — same dense agenda-row anatomy; Keel puts the retry on the failed surface itself.
- **Re-score `w37-r1` fixes (`w37-r2`):** one event count (above); the all-day chip label lost its `· {n}`; the headline block (`PageSummary`, source error lines, `Retry`) is the `calendar-headline` shot anchor declaring `loading error empty` — exactly the states production renders there.

### Wave 37 round (`w37-r1` after #160; `w37-r2` after #164; `w37-r3` after #166; `w37-r4` after #167 — basalt-ui 2.23.0)

- **Reviewer (`w37-r1`):** fail on the basalt measurer. Fixed (confirmed, #160): an all-day-only day header reads `1 event · all day`; Tasks under `error` reads `Tasks failed to load` with its own `Retry`; no `— reload to retry` left. **New (argo):** P2 — headers, the `Next 7 days` badge and the summary counted events three ways; P3 — an all-day-only day stated its count twice (`… · all day` over `ALL DAY · 1`); harness — no page-level anchor under `error`, so the headline Retry was unshot.
- **Re-score `w37-r2` (after #164):** fail. Fixed (confirmed): one event count everywhere (live, non-cancelled, all-day included, tasks excluded; booked time timed-only) — the headers add up to the badge; the chip label is `All day`; today's all-day chips sit in the Today card; the new `calendar-headline` anchor shoots loading / error / empty. **New (argo, P1):** under `error` a Microsoft 365 sign-in failure had no next step (Google had `Re-authorize`, Retry is hidden for sign-in failures).
- **Re-score `w37-r3` (after #166):** fail on the basalt measurer only. Fixed (confirmed): every sign-in failure carries one step on its line — Google `Re-authorize`, Microsoft 365 `Re-seed on the laptop: {command}` with `Copy command`. New (argo, P3): the 390 headline split the product name.
- **Re-score `w37-r4` (after #167):** fail on the basalt measurer only (Today `emptyRatio` counts skeleton bars). Fixed (confirmed): `Microsoft 365` never splits. Declined with reason: a Retry on each failed calendar card (the one-form rule puts the step once on the headline; Tasks, a separate gap, carries its own). Carried (basalt): the `Meter` null `—` under week-strip tracks. Carried (argo, P3): `Nothing due in the next 7 days.` under an `overdue or due` scope. No lost fact.
- **Against Keel:** close — Keel's `schedule-item` row anatomy; Keel puts the retry on the failed card itself.

### Wave 38 round

- **Tasks-due empty names its whole scope:** the card is scoped `Overdue or due within 7 days`, so its empty line reads `Nothing overdue or due in the next 7 days.` (was `Nothing due in the next 7 days.`). Closes the Wave 37 carried P3. No lost fact.
