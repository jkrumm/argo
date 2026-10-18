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
- All-day chip row sits between the summary sentence and the grid.
- The legend is deleted. Charts: none new; the Week and Month grids stay as tabs.

**390.** Single column: summary, all-day chips, `Today` agenda, free-block cell, week strip card, `Next 7 days`, tasks. Rows do not wrap: duration moves under the time, the source chip drops into the muted meta line. The Week tab renders a 3-day window anchored on the selected `date` (± 1 day, so `Today` and the arrows move it); Month is a dot-per-day grid.

## Copy

Placeholders; the format is the contract.

- Page summary: `{n} meetings today, {booked} booked · next in {n} min · {hours} this week`
- Empty day: `No events today · 10h free`
- Section headings: `Today · {n}`, `Next 7 days · {n}`, `Tasks due · {n}`, `All day · {n}`
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
- Source errors read `{source} unavailable — {reason}` plus a `Re-authorize` link, and the failed source reads `unavailable` in the split; with the work feed down, personal hours are marked `(partial)` (personal is booked minus work, so it is a ceiling).

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

- **Unknown is a dash.** `agendaSummary`, `dayLoad` and `summarySentence` take the set of sources that have not answered (failed with nothing of the window cached, or still loading). Every figure that depends on one is `null` and renders `—`: the summary (`— meetings today · next — · — this week`), the free-block cell, each strip row and every day in Next 7 days (`—`, never `free`). A calendar's own split figure stays exact (`Work —` beside `Personal 3h`); the split bar is drawn only when both classes answered.
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
- Headline: the summary in `agenda-view.tsx` is `PageSummary` — sentence `{n} meetings today, {booked} booked`, facts `next in {m}` and `{booked} booked this week` (`summaryParts`, tested); unknown sources read `— meetings today` with dashed facts.

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
