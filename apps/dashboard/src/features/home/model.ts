import { addDays, startOfDay as startOfDayDate } from 'date-fns'
import { localDayKey } from '../../lib/local-day'
import type { SourceClass } from '../../lib/queries/calendar'
import { NBSP, formatDuration, withUnit } from '../../lib/format'
import { GARMIN_SYNC_HOURS, RECOVERY_DAYS } from '../garmin-health/model'
import { applyVisibilityFilter } from '../garmin-health/visibility'
import { CANCELLED_PREFIX } from '../calendar/derive'
import { FACT_SEPARATOR } from '../../lib/text-breaks'
import { firstClause, flatten, lastWhitespace, stripShortcodes } from '../../lib/text'

// Pure derivations for the Today page: meetings, tasks, the Garmin readings, the activity stream
// and the summary sentence. No React, no queries. A reading that is absent stays `null` (rendered
// `—`), never 0.

const MIN_MS = 60_000

// Day boundaries are calendar arithmetic (`addDays`), never a fixed 24 h: a DST day is 23 or 25 h.
const startOfDay = (ms: number) => startOfDayDate(ms).getTime()
const nextDayStart = (ms: number) => addDays(startOfDayDate(ms), 1).getTime()

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** `09:30` for an epoch ms: the one clock format of the Today page. Built per call: a formatter cached at import would freeze the zone the tests switch at runtime. */
export const clockOf = (ms: number): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

/** `text` cut at the last word boundary within `max` characters, with an ellipsis; whole if it fits. */
function leadOf(text: string, max: number): string {
  const flat = flatten(text)
  if (flat.length <= max) return flat
  const head = flat.slice(0, max)
  const lastSpace = lastWhitespace(head)
  const atWord = lastSpace > max / 2
  const kept = atWord ? head.slice(0, lastSpace) : head.slice(0, max - 1)
  const withoutTail = kept.replace(/[\s,;:.\-–—]+$/, '')
  return `${withoutTail}…`
}

// ── Meetings ─────────────────────────────────────────────────────────────────────────────────

/** The fields of a Google or M365 calendar event the page reads (`attendees` and `videoLink` ride the raw payload). */
export type RawCalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  isAllDay?: boolean | undefined
  /** Set by the API (Graph / Google); absent from an older image, where the title prefix decides. */
  isCancelled?: boolean | undefined
  attendees?: readonly unknown[] | undefined
  videoLink?: string | null | undefined
}

export type Meeting = {
  key: string
  title: string
  startMs: number
  endMs: number
  durationMin: number
  attendees: number
  videoLink: string | null
  sourceClass: SourceClass
}

export type Agenda = {
  /** Source classes whose calendar answered. */
  loaded: SourceClass[]
  /** Source classes whose calendar has not: an empty day is then partial, not free. */
  unavailable: SourceClass[]
  /** Timed meetings starting today, earliest first; cancelled ones (Calendar's `Canceled:` / `Abgesagt:` rule) are not meetings and are left out. */
  meetings: Meeting[]
  /** Titles of all-day events covering today. */
  allDay: string[]
}

const CLASS_LABEL: Record<SourceClass, string> = { work: 'Work', personal: 'Personal' }

export const classLabels = (classes: readonly SourceClass[]): string =>
  classes.map((c) => CLASS_LABEL[c]).join(' and ')

/** What an agenda with no timed meeting says: free only when every calendar answered, else which one is missing. */
export function noMeetingsLabel(a: Pick<Agenda, 'loaded' | 'unavailable'>): string {
  if (a.unavailable.length === 0) return 'No meetings today'
  return `No ${a.loaded.map((c) => CLASS_LABEL[c]).join(' or ')} meetings today · ${classLabels(a.unavailable)} unavailable`
}

/** Calendar's rule exactly (`payload.isCancelled = event.isCancelled ?? CANCELLED_PREFIX.test(title)`), so Home counts the same meetings. */
const isCancelledEvent = (e: Pick<RawCalendarEvent, 'title' | 'isCancelled'>) =>
  e.isCancelled ?? CANCELLED_PREFIX.test(e.title)

export type LaterMeeting = { title: string; startMs: number }

/** The first timed meeting after today in the fetched window (7 days), or `null` when there is none. */
export function laterMeeting(feeds: readonly CalendarFeed[], now: number): LaterMeeting | null {
  const from = nextDayStart(now)
  let best: LaterMeeting | null = null
  for (const { events } of feeds) {
    for (const e of events) {
      if (e.isAllDay || isDateOnly(e.start) || isCancelledEvent(e)) continue
      const startMs = parseMs(e.start)
      if (startMs === null || startMs < from) continue
      if (best === null || startMs < best.startMs) best = { title: e.title, startMs }
    }
  }
  return best
}

/** `Mon 09:30`: when a meeting outside today starts. */
export const weekdayTime = (ms: number): string =>
  `${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(ms)} ${clockOf(ms)}`

const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Local-midnight ms of a `YYYY-MM-DD` string (not UTC: an all-day event is a calendar day). */
const dateOnlyMs = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).getTime()
}

/** One day's agenda from the merged calendar sources. A feed that failed contributes nothing here; the page says so separately. */
export type CalendarFeed = { sourceClass: SourceClass; events: readonly RawCalendarEvent[] }

export function todayAgenda(
  feeds: readonly CalendarFeed[],
  now: number,
  unavailable: readonly SourceClass[] = [],
): Agenda {
  const dayStart = startOfDay(now)
  const dayEnd = nextDayStart(now)
  const meetings: Meeting[] = []
  const allDay: string[] = []
  for (const { sourceClass, events } of feeds) {
    for (const e of events) {
      if (isCancelledEvent(e)) continue
      if (e.isAllDay || isDateOnly(e.start)) {
        const from = isDateOnly(e.start) ? dateOnlyMs(e.start) : parseMs(e.start)
        const to = isDateOnly(e.end) ? dateOnlyMs(e.end) : parseMs(e.end)
        if (from === null) continue
        // An all-day end is exclusive; a missing or inverted one means that single day.
        const last = to === null || to <= from ? nextDayStart(from) : to
        if (from < dayEnd && last > dayStart) allDay.push(e.title)
        continue
      }
      const startMs = parseMs(e.start)
      const endMs = parseMs(e.end)
      if (startMs === null || startMs < dayStart || startMs >= dayEnd) continue
      const end = endMs !== null && endMs >= startMs ? endMs : startMs
      meetings.push({
        key: e.id,
        title: e.title,
        startMs,
        endMs: end,
        durationMin: Math.round((end - startMs) / MIN_MS),
        attendees: e.attendees?.length ?? 0,
        videoLink: e.videoLink ?? null,
        sourceClass,
      })
    }
  }
  meetings.sort((a, b) => a.startMs - b.startMs)
  return {
    meetings,
    allDay,
    loaded: feeds.map((f) => f.sourceClass),
    unavailable: [...unavailable],
  }
}

/** The first meeting that has not started yet. */
export function nextMeeting(meetings: readonly Meeting[], now: number): Meeting | null {
  return meetings.find((m) => m.startMs > now) ?? null
}

export type MeetingState = 'past' | 'now' | 'upcoming'

export const meetingState = (m: Meeting, now: number): MeetingState =>
  m.endMs <= now ? 'past' : m.startMs <= now ? 'now' : 'upcoming'

/** `in 25 min` / `in 1 h 30 min`: the app's one duration spelling. */
export const countdownLabel = (ms: number): string => `in ${formatDuration(Math.max(0, ms))}`

/** The longest a meeting name runs in a strip cell footer. */
const MEETING_NAME_MAX = 24

/** A meeting's name in its shortest form: the first clause, cut at a word when still long; `null` with no name. */
export function shortMeetingName(title: string): string | null {
  const name = firstClause(stripShortcodes(title))
  return name === '' ? null : leadOf(name, MEETING_NAME_MAX)
}

/** The day axis of the next-meeting cell: 08–19 h, widened when a meeting falls outside it. */
const DAY_AXIS: { from: number; to: number } = { from: 8, to: 19 }

export function dayAxis(meetings: readonly Meeting[]): { from: number; to: number } {
  let { from, to } = DAY_AXIS
  for (const m of meetings) {
    const s = new Date(m.startMs)
    from = Math.min(from, s.getHours())
    to = Math.max(to, Math.min(24, s.getHours() + 1))
  }
  return { from, to }
}

/** Fraction (0–1) along the axis for a time of day, clamped. */
export function axisPosition(ms: number, axis: { from: number; to: number }): number {
  const d = new Date(ms)
  const hours = d.getHours() + d.getMinutes() / 60
  return Math.min(1, Math.max(0, (hours - axis.from) / (axis.to - axis.from)))
}

// ── Tasks ────────────────────────────────────────────────────────────────────────────────────

type RawTask = { status?: number | undefined; dueDate?: string | null | undefined }

const DUE_SOON_DAYS = 7

export const localKey = (ms: number) => localDayKey(ms)

/** Open TickTick tasks past due and due within the next 7 days, by local calendar day. */
export function taskCounts(
  tasks: readonly RawTask[],
  now: number,
): { overdue: number; dueSoon: number; open: number } {
  const today = localKey(now)
  const horizon = localKey(addDays(now, DUE_SOON_DAYS).getTime())
  let overdue = 0
  let dueSoon = 0
  let open = 0
  for (const t of tasks) {
    if (t.status !== 0) continue
    open += 1
    if (!t.dueDate || t.dueDate.length < 10) continue
    const due = t.dueDate.slice(0, 10)
    if (due < today) overdue += 1
    else if (due <= horizon) dueSoon += 1
  }
  return { overdue, dueSoon, open }
}

// ── Garmin readings ──────────────────────────────────────────────────────────────────────────

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export type RecoveryReading = {
  score: number | null
  /** Mean of the window's measured days; `null` with no measured day. */
  mean: number | null
  days: number
  ceiling: number | null
  trend: number[]
  /** The day the score belongs to (`YYYY-MM-DD`); `null` when the snapshot carries none. */
  date: string | null
  /** The score is for the local today. A last scored day that is not today must not read as today's. */
  isToday: boolean
  /** The newest scored day in the window, for the pre-sync gap's wording (`recoveryGap`). */
  last: { value: number; date: string } | null
}

/**
 * Home's recovery series from date-ascending `points`: the visibility-filtered window (default
 * `hideToday` rule) with an unscored today dropped, plus today's row appended when it carries a
 * score the filter hid. Recovery locks overnight, so a scored today ends the trend on the
 * headline's day; the pre-sync gap's window is otherwise unchanged.
 */
export function recoveryWindow<T extends { date: string; recovery: number | null }>(
  points: readonly T[],
  now: number,
): T[] {
  const today = localKey(now)
  const visible = applyVisibilityFilter(points, (p) => p.date).filter(
    (p) => p.date !== today || isNum(p.recovery),
  )
  const hidden = visible.some((p) => p.date === today)
    ? undefined
    : points.find((p) => p.date === today && isNum(p.recovery))
  return hidden ? [...visible, hidden] : visible
}

export function recoveryReading(
  snapshot: { recovery: number | null; ceiling: number | null; date?: string | null } | undefined,
  points: readonly { recovery: number | null }[] | undefined,
  now: number,
  last: RecoveryReading['last'] = null,
): RecoveryReading {
  const trend = (points ?? []).map((p) => p.recovery).filter(isNum)
  return {
    score: isNum(snapshot?.recovery) ? snapshot.recovery : null,
    mean: trend.length === 0 ? null : trend.reduce((a, b) => a + b, 0) / trend.length,
    days: trend.length,
    ceiling: isNum(snapshot?.ceiling) ? snapshot.ceiling : null,
    trend,
    date: snapshot?.date ?? null,
    isToday: snapshot?.date === localKey(now),
    last,
  }
}

/** The tile's footer: the window mean (whenever there is one) plus the day-fill fact for this reading. */
export function recoveryFooter(
  { mean, days, isToday }: RecoveryReading,
  /** The pre-sync gap line, which stands in for the day-fill fact when today has no score. */
  gap?: string,
): string {
  const parts = [
    ...(mean === null ? [] : [`${withUnit(RECOVERY_DAYS, 'd')} mean${NBSP}${Math.round(mean)}`]),
    // `{n}/{total} d` is one unit-bound figure and the only break left falls before `observed`,
    // so a narrow footer breaks between phrases, never inside the fill fact.
    gap ??
      (isToday
        ? `${days}/${withUnit(RECOVERY_DAYS, 'd')} observed`
        : `today fills after the next Garmin sync (every ${withUnit(GARMIN_SYNC_HOURS, 'h')})`),
  ]
  return parts.filter(Boolean).join(FACT_SEPARATOR)
}

export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'

export type AcwrReading = { acwr: number | null; zone: AcwrZone | null; date: string | null }

/** The most recent day with a measured ACWR, not merely the last row. */
export function acwrReading(
  points: readonly { date: string; acwr: number | null; zone: AcwrZone | null }[] | undefined,
): AcwrReading {
  const last = (points ?? []).findLast((p) => isNum(p.acwr))
  return last
    ? { acwr: last.acwr, zone: last.zone, date: last.date }
    : { acwr: null, zone: null, date: null }
}

// ── Activity stream ──────────────────────────────────────────────────────────────────────────

export type ActivityEvent = {
  key: string
  ms: number
  actor: 'calendar'
  /** The verb and its subject; wraps at its spaces, never cut. */
  title: string
}

/** Rows older than the start of yesterday are history, not "today's stream". */
const activityHorizon = (now: number) => addDays(startOfDayDate(now), -1).getTime()

/** Today's meetings that have already started: the calendar's contribution to the stream. */
export function calendarEvents(meetings: readonly Meeting[], now: number): ActivityEvent[] {
  return meetings
    .filter((m) => m.startMs <= now)
    .map((m) => ({
      key: `c-${m.key}`,
      ms: m.startMs,
      actor: 'calendar' as const,
      title: `started ${m.title}`,
    }))
}

/** Newest first, inside the horizon, not in the future. `total` counts every row before the cap. */
export function activityStream(
  events: readonly ActivityEvent[],
  now: number,
): { events: ActivityEvent[]; total: number } {
  const horizon = activityHorizon(now)
  const live = events
    .filter((e) => e.ms >= horizon && e.ms <= now)
    .map((e) => ({
      ...e,
      title: stripShortcodes(e.title),
    }))
    .toSorted((a, b) => b.ms - a.ms)
  return { events: live, total: live.length }
}

/** With nothing in the window: the horizon, and where new events appear. */
export const emptyStreamLabel = (now: number) =>
  `No events since ${clockOf(activityHorizon(now))} yesterday — calendar events appear here.`

// ── Summary sentence ─────────────────────────────────────────────────────────────────────────

export type HomeSummaryParts = { sentence: string; facts: string[] }

/** The headline of the day's meetings, and which calendar could not be read. `null` agenda: no calendar answered. */
export function homeSummaryParts(
  agenda: Pick<Agenda, 'meetings' | 'unavailable'> | null,
  now: number,
): HomeSummaryParts {
  if (agenda === null) return { sentence: 'Calendar unavailable.', facts: [] }
  const facts =
    agenda.unavailable.length === 0 ? [] : [`${classLabels(agenda.unavailable)} unavailable`]
  const total = agenda.meetings.length
  const ahead = agenda.meetings.filter((m) => m.startMs > now).length
  const noun = total === 1 ? 'meeting' : 'meetings'
  const sentence =
    total === 0
      ? 'No meetings today.'
      : ahead === 0
        ? `${total} ${noun} today, none left.`
        : `${ahead} of ${total} ${noun} still ahead today.`
  return { sentence, facts }
}

export type TaskFeed = 'loading' | 'error' | 'ready'

/** The meetings card's tasks line: `lead` always, `rest` after a middle dot, `overdue` flags the lead as bad. */
export function tasksLine(
  tasks: { overdue: number; dueSoon: number; open: number } | null,
  feed: TaskFeed,
): { lead: string; rest?: string; overdue: boolean } {
  if (tasks === null) {
    return {
      lead: feed === 'error' ? 'Tasks: failed to load — reload to retry' : 'Tasks: loading',
      overdue: false,
    }
  }
  if (tasks.open === 0) return { lead: 'Tasks: none open', overdue: false }
  return {
    lead: `Tasks: ${tasks.overdue} overdue`,
    rest: ` · ${tasks.dueSoon} due within ${withUnit(DUE_SOON_DAYS, 'd')}`,
    overdue: tasks.overdue > 0,
  }
}
