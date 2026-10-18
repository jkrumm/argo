/**
 * Every number the Calendar page shows is derived here: day load, booked hours (per day, week and
 * source class), the longest free block, the Week grid window, the agenda grouping and the summary
 * figures. Pure and React-free — components render this module's output and compute nothing.
 *
 * Times arrive as local wall-clock strings (`YYYY-MM-DD HH:mm:ss`, see `lib/queries/calendar.ts`).
 * Day bucketing runs on `YYYY-MM-DD` keys and calendar arithmetic on `new Date(y, m, d + n)`, never
 * on `+ 24 h`, so a DST day (23 or 25 h) lands in the right bucket; durations are real elapsed time.
 */
import type { ScheduleEventData } from '@mantine/schedule'
import type { CalendarEventPayload, SourceClass } from '../../lib/queries/calendar'

export type CalendarItem = ScheduleEventData<CalendarEventPayload>

/** The window "free time" is measured in: the working day. */
export const FREE_WINDOW = { startH: 8, endH: 18 } as const
/** The shared track of the day-load strip, in hours; its tick marks this. */
export const DAY_TARGET_H = 8
/** The Week grid never opens wider than this ... */
export const WEEK_WINDOW_CLAMP = { startH: 7, endH: 22 } as const
/** ... and falls back to this when the week has no timed events. */
export const WEEK_WINDOW_FALLBACK = { startH: 8, endH: 18 } as const

const MIN_MS = 60_000

export type DayKey = string // YYYY-MM-DD

export type Interval = readonly [startMs: number, endMs: number]

export function toDate(local: string): Date {
  const [d = '', t = '00:00:00'] = local.split(' ')
  const [y = 0, mo = 1, day = 1] = d.split('-').map(Number)
  const [h = 0, mi = 0, s = 0] = t.split(':').map(Number)
  return new Date(y, mo - 1, day, h, mi, s)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function dayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `Wed 14` — the label every day heading and strip row uses. */
export function dayLabel(key: DayKey): string {
  return keyToDate(key)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
    .replace(',', '')
}

/** `19 May` — for dates where the weekday alone is ambiguous (overdue). */
export function shortDate(key: DayKey): string {
  return keyToDate(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function keyToDate(key: DayKey): Date {
  return toDate(`${key} 00:00:00`)
}

export function addDays(key: DayKey, n: number): DayKey {
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + n))
}

/** The seven local days of the Monday-start week holding `key`. */
export function weekKeys(key: DayKey): DayKey[] {
  const base = keyToDate(key)
  const sinceMonday = (base.getDay() + 6) % 7
  const monday = addDays(key, -sinceMonday)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

function dayStartMs(key: DayKey): number {
  return keyToDate(key).getTime()
}

function dayEndMs(key: DayKey): number {
  return keyToDate(addDays(key, 1)).getTime()
}

function atHourMs(key: DayKey, hour: number): number {
  const [y = 0, m = 1, d = 1] = key.split('-').map(Number)
  return new Date(y, m - 1, d, hour, 0, 0).getTime()
}

// ---- classification -------------------------------------------------------------------------

export function isTask(event: CalendarItem): boolean {
  return event.payload?.source === 'ticktick'
}

/** A meeting with a clock time: not a task, not all-day. */
export function isTimed(event: CalendarItem): boolean {
  return !isTask(event) && event.payload?.isAllDay !== true
}

/** M365 keeps a cancelled meeting on the calendar and prefixes its title (en and de). */
const CANCELLED_PREFIX = /^\s*(abgesagt|canceled|cancelled)\s*:\s*/i

/** The API's `isCancelled` (Graph's flag; always false for Google and tasks). */
export function isCancelled(event: CalendarItem): boolean {
  return event.payload?.isCancelled === true
}

/** The title without the `Canceled:` / `Abgesagt:` prefix Outlook adds, for a cancelled meeting only: its row says "Cancelled" once, in its meta. A live meeting keeps its title as written. */
export function displayTitle(event: CalendarItem): string {
  if (!isCancelled(event)) return event.title
  return event.title.replace(CANCELLED_PREFIX, '').trim() || 'Untitled meeting'
}

/** Meetings that still happen: the basis of every count, booked hour, free block and "next". */
export function timedEvents(events: readonly CalendarItem[]): CalendarItem[] {
  return events.filter((e) => isTimed(e) && !isCancelled(e))
}

export function durationMin(event: CalendarItem): number {
  return (toDate(String(event.end)).getTime() - toDate(String(event.start)).getTime()) / MIN_MS
}

// ---- intervals ------------------------------------------------------------------------------

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.toSorted((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** The events' busy time inside `[fromMs, toMs]`, overlaps merged (a double booking counts once). */
function busyWithin(events: readonly CalendarItem[], fromMs: number, toMs: number): Interval[] {
  const clipped: Interval[] = []
  for (const event of events) {
    const start = Math.max(toDate(String(event.start)).getTime(), fromMs)
    const end = Math.min(toDate(String(event.end)).getTime(), toMs)
    if (end > start) clipped.push([start, end])
  }
  return mergeIntervals(clipped)
}

function totalMin(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0) / MIN_MS
}

// ---- day load and booked hours --------------------------------------------------------------

/** `null` figures mean "unknown": a calendar this day depends on has not answered. Never 0. */
export type DayLoad = { key: DayKey; bookedMin: number | null; count: number | null }

/** Booked minutes of `live` meetings on `key`, overlaps merged: the one clip-and-merge. */
function bookedMinOf(live: readonly CalendarItem[], key: DayKey): number {
  return totalMin(busyWithin(live, dayStartMs(key), dayEndMs(key)))
}

export function bookedMinOnDay(events: readonly CalendarItem[], key: DayKey): number {
  return bookedMinOf(timedEvents(events), key)
}

/** The meetings that still happen on `key`. */
export function eventsOnDay(events: readonly CalendarItem[], key: DayKey): CalendarItem[] {
  return rowsOnDay(timedEvents(events), key)
}

function rowsOnDay(timed: readonly CalendarItem[], key: DayKey): CalendarItem[] {
  const from = dayStartMs(key)
  const to = dayEndMs(key)
  return timed
    .filter((e) => {
      const start = toDate(String(e.start)).getTime()
      const end = toDate(String(e.end)).getTime()
      return start < to && (end > from || start === from)
    })
    .toSorted((a, b) => String(a.start).localeCompare(String(b.start)))
}

/** With `incomplete` (a source is failed or still loading) every figure is unknown, not zero. */
export function dayLoad(
  events: readonly CalendarItem[],
  keys: readonly DayKey[],
  incomplete = false,
): DayLoad[] {
  return keys.map((key) => ({
    key,
    bookedMin: incomplete ? null : bookedMinOnDay(events, key),
    count: incomplete ? null : eventsOnDay(events, key).length,
  }))
}

export type SourceSplit = Record<SourceClass, number>

/**
 * Booked minutes over `keys`, split so that Work + Personal always equals the booked total: Work is
 * the union of the work events, Personal is the time only personal events cover — a minute both
 * calendars hold is attributed once, to Work.
 */
export function bookedBySourceClass(
  events: readonly CalendarItem[],
  keys: readonly DayKey[],
): SourceSplit {
  const timed = timedEvents(events)
  const work = timed.filter((e) => e.payload?.sourceClass === 'work')
  const split: SourceSplit = { work: 0, personal: 0 }
  for (const key of keys) {
    const workMin = totalMin(busyWithin(work, dayStartMs(key), dayEndMs(key)))
    split.work += workMin
    split.personal += totalMin(busyWithin(timed, dayStartMs(key), dayEndMs(key))) - workMin
  }
  return split
}

export function weekBookedMin(events: readonly CalendarItem[], keys: readonly DayKey[]): number {
  return dayLoad(events, keys).reduce((sum, d) => sum + (d.bookedMin ?? 0), 0)
}

// ---- free time ------------------------------------------------------------------------------

export type FreeBlock = { start: Date; end: Date; minutes: number }

/**
 * The longest gap inside `FREE_WINDOW` on `key`. Overlapping events merge; an event that crosses
 * the window edge is clipped to it. With `notBefore` (now, for today) the gap before that moment
 * does not count. `null` when no time is left — never a zero block.
 */
export function longestFreeBlock(
  events: readonly CalendarItem[],
  key: DayKey,
  notBefore?: Date,
): FreeBlock | null {
  // Rounded UP to a whole minute: the block's length and the printed `HH:mm` start then agree
  // (a raw `now` carries seconds, which made `15:00–18:00` read as 2h 59m).
  const from = notBefore
    ? Math.ceil(notBefore.getTime() / MIN_MS) * MIN_MS
    : Number.NEGATIVE_INFINITY
  const windowStart = Math.max(atHourMs(key, FREE_WINDOW.startH), from)
  const windowEnd = atHourMs(key, FREE_WINDOW.endH)
  if (windowEnd <= windowStart) return null

  const busy = busyWithin(timedEvents(events), windowStart, windowEnd)
  let best: [number, number] | null = null
  let cursor = windowStart
  for (const [start, end] of [...busy, [windowEnd, windowEnd] as const]) {
    if (start > cursor && (!best || start - cursor > best[1] - best[0])) best = [cursor, start]
    cursor = Math.max(cursor, end)
  }
  if (!best) return null
  return {
    start: new Date(best[0]),
    end: new Date(best[1]),
    minutes: (best[1] - best[0]) / MIN_MS,
  }
}

// ---- week grid window -----------------------------------------------------------------------

export type HourWindow = { startH: number; endH: number }

/**
 * The Week tab's visible hours from the TIMED events of `keys` only (all-day items and tasks are
 * excluded): earliest start − 1 h to latest end + 1 h, clamped to `WEEK_WINDOW_CLAMP`.
 */
export function weekWindow(events: readonly CalendarItem[], keys: readonly DayKey[]): HourWindow {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const key of keys) {
    const from = dayStartMs(key)
    const to = dayEndMs(key)
    for (const event of eventsOnDay(events, key)) {
      const start = Math.max(toDate(String(event.start)).getTime(), from)
      const end = Math.min(toDate(String(event.end)).getTime(), to)
      first = Math.min(first, new Date(start).getHours() + new Date(start).getMinutes() / 60)
      // An event running to midnight ends at hour 24, not 0.
      const endHour = end === to ? 24 : new Date(end).getHours() + new Date(end).getMinutes() / 60
      last = Math.max(last, endHour)
    }
  }
  if (!Number.isFinite(first)) return { ...WEEK_WINDOW_FALLBACK }
  const { startH: lo, endH: hi } = WEEK_WINDOW_CLAMP
  const startH = Math.min(Math.max(Math.floor(first) - 1, lo), hi - 1)
  const endH = Math.max(Math.min(Math.ceil(last) + 1, hi), startH + 1)
  return { startH, endH }
}

export function hourToTime(hour: number): string {
  return `${pad(hour)}:00:00`
}

// ---- agenda ---------------------------------------------------------------------------------

/** Work and Personal labels, shared by the row meta and the booked-hours split. */
export const SPLIT_LABEL = { work: 'Work', personal: 'Personal' } as const
/** Past this many invitees the accepted ratio stops being useful ("13/123 accepted"). */
const MAX_RATIO_ATTENDEES = 12

function eventMeta(payload: CalendarEventPayload | undefined): string {
  const parts: string[] = []
  if (payload?.sourceClass) parts.push(SPLIT_LABEL[payload.sourceClass])
  if (payload?.source === 'google' && payload.calendarName) parts.push(payload.calendarName)
  const total = payload?.attendeeTotal ?? 0
  // A ratio is only legible on a small invite; a large one reads as a head count.
  if (total > MAX_RATIO_ATTENDEES) parts.push(`${total} people`)
  else if (total > 0) parts.push(`${payload?.attendeeAccepted ?? 0}/${total} accepted`)
  return parts.join(' · ')
}

/** One agenda line, fully derived: the component only places these fields. */
export type AgendaRow = {
  event: CalendarItem
  cancelled: boolean
  start: string
  durationMin: number
  /** Without the cancellation prefix. */
  title: string
  /** `Cancelled · Work · 3/5 accepted`; empty when there is nothing to say. */
  meta: string
}

function agendaRow(event: CalendarItem): AgendaRow {
  const cancelled = isCancelled(event)
  return {
    event,
    cancelled,
    start: String(event.start).slice(11, 16),
    durationMin: durationMin(event),
    title: displayTitle(event),
    meta: [cancelled ? 'Cancelled' : '', eventMeta(event.payload)].filter(Boolean).join(' · '),
  }
}

export type AgendaDay = {
  key: DayKey
  /** Every timed meeting of the day, cancelled ones included (rendered muted). */
  rows: AgendaRow[]
  /** Meetings that still happen; `bookedMin` covers the same set. */
  count: number
  bookedMin: number
}

/** The one per-day derivation: rows, count and booked time all come from the same filtered array. */
export function agendaDay(events: readonly CalendarItem[], key: DayKey): AgendaDay {
  const listed = rowsOnDay(events.filter(isTimed), key)
  const live = listed.filter((e) => !isCancelled(e))
  return {
    key,
    rows: listed.map(agendaRow),
    count: live.length,
    bookedMin: bookedMinOf(live, key),
  }
}

export function agendaDays(events: readonly CalendarItem[], keys: readonly DayKey[]): AgendaDay[] {
  return keys.map((key) => agendaDay(events, key))
}

/** `2 events · 3h` / `no meetings` / `all cancelled` — the day heading's right-hand side. */
export function dayHeadLabel(
  day: AgendaDay,
  format: (min: number) => string,
  liveAllDay = 0,
): string {
  if (day.count > 0)
    return `${day.count} ${day.count === 1 ? 'event' : 'events'} · ${format(day.bookedMin)}`
  // A live all-day item means the day is not wholly cancelled.
  return day.rows.length > 0 && liveAllDay === 0 ? 'all cancelled' : 'no meetings'
}

/** Live all-day events (never tasks, never cancelled) covering `key`, titles intact. */
export function allDayEvents(events: readonly CalendarItem[], key: DayKey): CalendarItem[] {
  return events.filter((e) => {
    if (isTask(e) || isCancelled(e) || e.payload?.isAllDay !== true) return false
    const startKey = String(e.start).slice(0, 10)
    const endKey = String(e.end).slice(0, 10)
    return startKey <= key && (endKey > startKey ? key < endKey : key === startKey)
  })
}

export type NextEvent = { event: CalendarItem; inMin: number }

/** The first timed event starting after `now`; `inMin` is whole minutes, rounded up. */
export function nextEvent(events: readonly CalendarItem[], now: Date): NextEvent | null {
  let best: { event: CalendarItem; startMs: number } | null = null
  for (const event of timedEvents(events)) {
    const startMs = toDate(String(event.start)).getTime()
    if (startMs <= now.getTime()) continue
    if (!best || startMs < best.startMs) best = { event, startMs }
  }
  return best
    ? { event: best.event, inMin: Math.ceil((best.startMs - now.getTime()) / MIN_MS) }
    : null
}

export type AgendaSummary = {
  todayKey: DayKey
  /** The Monday-start week holding today: the strip's rows and the summary's "this week". */
  weekKeys: DayKey[]
  /** A calendar is failed or still loading: every figure below is `null` (unknown), never 0. */
  incomplete: boolean
  todayCount: number | null
  todayBookedMin: number | null
  weekBookedMin: number | null
  next: NextEvent | null
}

/** The figures of the summary sentence — and of the strip beside it — from one derivation. */
export function agendaSummary(
  events: readonly CalendarItem[],
  now: Date,
  unknown: ReadonlySet<SourceClass> = new Set(),
): AgendaSummary {
  const todayKey = dayKey(now)
  const keys = weekKeys(todayKey)
  const incomplete = unknown.size > 0
  return {
    todayKey,
    weekKeys: keys,
    incomplete,
    todayCount: incomplete ? null : eventsOnDay(events, todayKey).length,
    todayBookedMin: incomplete ? null : bookedMinOnDay(events, todayKey),
    weekBookedMin: incomplete ? null : weekBookedMin(events, keys),
    // The next meeting may sit in the calendar that has not answered.
    next: incomplete ? null : nextEvent(events, now),
  }
}

export type CalendarView = 'agenda' | 'week' | 'month'

/**
 * The first day the calendar queries must cover for a view, the Monday of: today's week on the
 * Agenda; the week of the day BEFORE the selected date on Week (the phone's 3-day window starts at
 * date − 1, the previous week's Sunday when `date` is a Monday); the first week of the month on
 * Month. The feed then holds the past days of that week as well as the days ahead.
 */
export function queryFromKey(view: CalendarView, selected: DayKey, today: DayKey): DayKey {
  const anchor =
    view === 'agenda'
      ? today
      : view === 'month'
        ? `${selected.slice(0, 7)}-01`
        : addDays(selected, -1)
  return weekKeys(anchor)[0] ?? anchor
}

// ---- tasks ----------------------------------------------------------------------------------

export type TaskTone = 'bad' | 'warn' | 'neutral'

export type TaskDue = {
  id: string
  title: string
  project: string | null
  dueKey: DayKey
  overdue: boolean
  tone: TaskTone
  /** `High` / `Medium` text so priority is never colour alone; `Low` and none are unlabeled. */
  label: 'High' | 'Medium' | null
}

function taskTone(priority: number | undefined): { tone: TaskTone; label: TaskDue['label'] } {
  if (priority !== undefined && priority >= 5) return { tone: 'bad', label: 'High' }
  if (priority !== undefined && priority >= 3) return { tone: 'warn', label: 'Medium' }
  return { tone: 'neutral', label: null }
}

const labelRank = (label: TaskDue['label']): number =>
  label === 'High' ? 2 : label === 'Medium' ? 1 : 0

/** Open tasks overdue or due within `horizonDays` of `todayKey` (inclusive of today), soonest first. */
export function tasksDue(
  events: readonly CalendarItem[],
  todayKey: DayKey,
  horizonDays = 7,
): TaskDue[] {
  const lastKey = addDays(todayKey, horizonDays - 1)
  return events
    .filter(isTask)
    .map((e): TaskDue => {
      const dueKey = String(e.start).slice(0, 10)
      return {
        id: String(e.id),
        title: e.title,
        project: e.payload?.projectName ?? null,
        dueKey,
        overdue: dueKey < todayKey,
        ...taskTone(e.payload?.priority),
      }
    })
    .filter((t) => t.dueKey <= lastKey)
    .toSorted((a, b) => a.dueKey.localeCompare(b.dueKey) || labelRank(b.label) - labelRank(a.label))
}
