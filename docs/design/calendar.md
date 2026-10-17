# Calendar — concept

Route `/calendar` (`?view=week|month&date=`) — `apps/dashboard/src/routes/calendar.tsx`, `features/calendar/calendar-page.tsx`, `lib/queries/calendar.ts`.

## Baseline verdict

- `calendar--dark--desktop.png` (week 42): a 7 × 15 h `@mantine/schedule` grid, 1,500 px tall, holding **2 all-day items**. About 95% of the surface is empty hour cells; the current-time line is the only live element. The all-day lane (72 px slot) truncates a title with an ellipsis.
- The legend (`Privat · Arbeit · Familie · Ferien · Work (M365) · Tasks (TickTick)`) is six same-weight dots in four near-identical blues/oranges; the hues do not carry a trend or status, so they are categorical decoration (sky vs cerulean vs deep sky are not tellable apart).
- No sentence says what the week holds. The data the API returns and the page drops: attendees with response status (Google), `videoLink`, `location`, `bodyPreview`, `organizer`, TickTick `priority`.
- Mobile (`calendar--dark--mobile.png`) renders the same grid at 390 px: one column per day is unreadable, so the page is effectively a scroll of empty hours.
- Slop by the owner's verdict: empty-hour density, a legend instead of meaning, no number anywhere on the page.
- **Distance-from-bar: 5** — it is a generic grid widget with no summary, no agenda, no use of the fields that make a meeting actionable.

## The question and the decision

- Question on opening: what is on today, what is next and when, and how loaded is the rest of the week?
- Decision: join/prepare the next meeting, spot the longest free block to protect for focus work, and move or decline something on an overloaded day.

## Datasets and encodings

| Dataset | Source | Shape (SPEC §3) | Today's encoding | Chosen encoding | Reason | Keel pattern |
|-|-|-|-|-|-|-|
| Today's timed events | `GET /calendar`, `GET /m365/calendar/upcoming` (`start`, `end`, `title`, `calendarName`, `attendees`, `videoLink`, `location`) | Event sequence | Blocks in a 15 h grid | Agenda list, one row per event: mono start time (`10:00`) over muted duration (`45m`), title, source chip (`Work`/`Personal`), attendee count with accepted ratio (`3/5 accepted`), `Join` icon-link when `videoLink`; the next event carries a pill `in 48m` | Time at the left edge keeps the title column clean; the pill answers "when" without reading the clock | `schedule-item`, `root` (Meetings 3) |
| Day load | Same events, summed per local day | Status over time + bounded ratio | Not shown | 7-row strip card: weekday, bar on a shared 0–8 h track with a tick at 8 h, mono `2h 30m` right-aligned, event count muted; today's row marked by a ring, not a fill | Length on a shared track ranks the days before any number is read | `metric-card-bar`, `stat-strip` |
| Free time | Gaps between events inside 08:00–18:00 | Single value | Not shown | One cell: `3h 15m` hero, caption `LONGEST FREE BLOCK · today`, muted `13:00–16:15` | The decision (protect focus time) needs one number and its window | `stat-cell` |
| Week by source | Booked hours per source class | Part of whole, 2 parts | Six-dot legend | One segmented bar `Work 7h 45m | Personal 3h 30m` with captions under the segments; hue only for these two categories | A categorical split earns two hues; calendar names move to muted text on the row | `metric-card-bar` (segments) |
| All-day events | `isAllDay: true` | List of references | 72 px lane, truncated | Chip row above the agenda: `All day · 2`, each chip full title, no truncation, wraps | Full text beats an ellipsis in a lane | `status-pill` |
| Tasks due | `GET /ticktick/projects/{id}/data` (`dueDate`, `priority`, `status`) | Status-dot list | Pushed into the week grid as all-day blocks with a flag glyph | Card `Tasks due · 4`: status dot (priority ≥ 5 `bad`, 3–4 `warn`, else neutral), title, project muted, due date mono right | A task is not a time block; priority is a status, which earns the dot | `activity-item` |
| Week grid | Same events | Event sequence (spatial) | Always 07:00–22:00 | Stays as the `Week` tab; window derived from the week's earliest start −1 h to latest end +1 h, clamped to 07:00–22:00 | A week with 2 all-day items stops rendering 15 empty hours | — |
| Month grid | Same events | Status over time | Mantine `MonthView` | Stays as the `Month` tab, unchanged | Day navigation tool; no redesign claim | — |
| Source errors | query errors | Status | Yellow `Alert` per source | One muted row in the summary line: `Google unavailable · re-authorize`, `—` in its figures | Failure is a state of the data, not a page banner | `status-pill` |

## Layout

**1440.** Tabs `Agenda · Week · Month` and date navigation stay in `PageBar` (`Agenda` is the new default). Below, the summary sentence. Then a two-column grid (container query, 2:1):

- Left: `Today · 3` agenda list, then `Next 7 days` day-grouped (`Mon 19`, `Tue 20`; days with no events are one muted line `Wed 21 · free`), each group headed by its count and booked hours.
- Right: the week strip card (day load + the source segmented bar underneath), then `Longest free block` cell, then `Tasks due · 4`.
- All-day chip row sits between the summary sentence and the grid.
- The legend is deleted. Charts: none new; the Week and Month grids stay as tabs.

**390.** Single column: summary, all-day chips, `Today` agenda, free-block cell, week strip card, `Next 7 days`, tasks. Rows do not wrap: duration moves under the time, the source chip drops into the muted meta line. The Week tab renders a 3-day window (today ± 1) at this width; Month is a dot-per-day grid.

## Copy

Illustrative numbers; the format is the contract.

- Page summary: `3 meetings today, 2h 30m booked · next in 48 min · 11h 15m this week`
- Empty day: `No events today · 8h free`
- Section headings: `Today · 3`, `Next 7 days · 9`, `Tasks due · 4`, `All day · 2`
- Strip card title: `Booked hours, week 42`; row `Tue 20   ▮▮▮▯▯▯▯▯   4h 15m   · 3`
- Cell caption: `LONGEST FREE BLOCK · today`; value `3h 15m`; muted `13:00–16:15`
- Source bar captions: `Work 7h 45m`, `Personal 3h 30m`
- Row meta: `45m · <source> · 3/5 accepted`; pill `in 48m`; link `Join`
- Task row: `<task> · <project> · due Tue 20`
- Error: `Google unavailable — token expired. Re-authorize`
- Replaces: the legend; any "What's coming up?" style subtitle (none exists today, none is allowed).

## Upstream candidates

- `EventList` day-groups + time column (maps to SPEC §4 `EventList`). Props: `groups: { label, count, meta? }[]`, `items: { time, duration?, title, chips?, status?, trailing? }[]`, `now?: Date` for the pill.
- `Meter` row variant for the day strip (maps to `Meter`). Props: `value`, `max`, `tick?`, `caption`, `size="row"`.
- `ScheduleRow` (time/duration column + title + status pill + trailing action) — new; Keel's `schedule-item`. Props: `start`, `durationMin`, `title`, `meta`, `pill?`, `action?`. Used by Calendar and the home Today page.

## Pass criteria

1. The first screen at 1440 shows a summary sentence with at least three live numbers and the next meeting's countdown.
2. No empty hour region taller than 120 px on the Agenda tab; the Week tab's visible window is derived from the week's events.
3. Every agenda row shows a mono start time and a duration with a unit.
4. The source legend is gone; hue appears only for the Work/Personal split.
5. The week strip's bars share one 0–8 h scale with a visible tick at 8 h and a mono hour value on each row.
6. Tasks appear as a dot list, not as grid blocks, and each priority dot has a text-equivalent in the row meta.
7. At 390 no row wraps and the Agenda tab needs no horizontal scroll.
8. No meeting title, person name or location appears in this doc or in any committed file.
