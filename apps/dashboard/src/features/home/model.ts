import { addDays, startOfDay as startOfDayDate } from 'date-fns'
import {
  clockTime,
  dayLabel,
  formatWaitDuration,
  headlineOf,
  peakWorking,
  type HourBucket,
} from '../agents/model'
import type { Narrative } from '../../lib/queries/agents'
import type { WardenRaw } from '../../lib/queries/warden'
import type { Decision } from '../../lib/decisions'
import type { SourceClass } from '../../lib/queries/calendar'
import { untilLabel } from '../calendar/summary'
import { stripShortcodes } from '../../lib/text'

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

/** `09:30` for an epoch ms: the one clock format of the Today page. */
export const clockOf = (ms: number): string => clockTime(new Date(ms).toISOString())

/** How often the Garmin sidecar syncs, in hours (the recovery cell's "when it fills"). */
export const GARMIN_SYNC_HOURS = 6

// ── Meetings ─────────────────────────────────────────────────────────────────────────────────

/** The fields of a Google or M365 calendar event the page reads (`attendees` and `videoLink` ride the raw payload). */
export type RawCalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  isAllDay?: boolean | undefined
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
  /** Timed meetings starting today, earliest first. */
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

export type LaterMeeting = { title: string; startMs: number }

/** The first timed meeting after today in the fetched window (7 days), or `null` when there is none. */
export function laterMeeting(feeds: readonly CalendarFeed[], now: number): LaterMeeting | null {
  const from = nextDayStart(now)
  let best: LaterMeeting | null = null
  for (const { events } of feeds) {
    for (const e of events) {
      if (e.isAllDay || isDateOnly(e.start)) continue
      const startMs = parseMs(e.start)
      if (startMs === null || startMs < from) continue
      if (best === null || startMs < best.startMs) best = { title: e.title, startMs }
    }
  }
  return best
}

/** `Mon 09:30`: when a meeting outside today starts. */
export const weekdayTime = (ms: number): string =>
  `${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(ms)} ${clockTime(new Date(ms).toISOString())}`

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

/** `in 25m` / `in 1h 30m`: the Calendar page's wording, so both pages count down the same way. */
export const countdownLabel = (ms: number): string =>
  untilLabel(Math.max(0, Math.round(ms / MIN_MS)))

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

const pad2 = (n: number) => String(n).padStart(2, '0')

export const localKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Open TickTick tasks past due and due within the next 7 days, by local calendar day. */
export function taskCounts(
  tasks: readonly RawTask[],
  now: number,
): { overdue: number; dueSoon: number } {
  const today = localKey(now)
  const horizon = localKey(addDays(now, DUE_SOON_DAYS).getTime())
  let overdue = 0
  let dueSoon = 0
  for (const t of tasks) {
    if (t.status !== 0 || !t.dueDate || t.dueDate.length < 10) continue
    const due = t.dueDate.slice(0, 10)
    if (due < today) overdue += 1
    else if (due <= horizon) dueSoon += 1
  }
  return { overdue, dueSoon }
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
}

export function recoveryReading(
  snapshot: { recovery: number | null; ceiling: number | null; date?: string | null } | undefined,
  points: readonly { recovery: number | null }[] | undefined,
  now: number,
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
  }
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
  actor: 'warden' | 'narrator' | 'calendar'
  /** The subject: shortens first (ellipsis) when the row is narrow. */
  title: string
  /** The end of the sentence (a transition path, a dispatch): always rendered whole, never clipped. */
  outcome?: string
  /** The entity chip: a project (a Warden row names its repo in the sentence instead). */
  chip?: string
  /** A muted second line: the item's own title. */
  detail?: string
  /** The row's whole sentence with every name unshortened: the tooltip when `title` or `chip` was shortened. */
  full?: string
}

/** Longest name a feed row shows before the model shortens it (the full name rides in `full`). */
const NAME_MAX = 18

/**
 * A repo or project name that fits a feed row: whole when it fits, else cut after its last `-`,
 * `_`, `/` or `.` separator that leaves at least half the limit; with no such separator the name is
 * hard-cut. Either way the cut ends in an ellipsis.
 */
export function shortName(name: string, max = NAME_MAX): string {
  if (name.length <= max) return name
  const head = name.slice(0, max - 1)
  const sep = Math.max(...['-', '_', '/', '.'].map((c) => head.lastIndexOf(c)))
  return `${sep >= max / 2 ? head.slice(0, sep) : head}…`
}

/** Rows older than the start of yesterday are history, not "today's stream". */
const activityHorizon = (now: number) => addDays(startOfDayDate(now), -1).getTime()

type Bag = Record<string, unknown>
const bag = (v: unknown): Bag | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : undefined
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Steps on one item closer together than this are one burst: one feed row, not one per step. */
const BURST_GAP_MS = 10 * MIN_MS

type Step = { ms: number; from: string | null; to: string | null; dispatch: string | null }

const stateLabel = (s: string) => s.replaceAll('_', ' ')

/** `new → triaged → working`: the path a burst took, repeated states collapsed. */
function pathOf(steps: readonly Step[]): string {
  const states: string[] = []
  const push = (s: string | null) => {
    if (s !== null && states.at(-1) !== s) states.push(stateLabel(s))
  }
  const first = steps.find((s) => s.to !== null)
  push(first?.from ?? null)
  for (const step of steps) push(step.to)
  return states.join(' → ')
}

/**
 * Warden's transitions and dispatches from the snapshot's per-event timelines, one row per burst
 * on an item (steps within {@link BURST_GAP_MS} of the previous one), timed at the last step.
 */
export function wardenEvents(raw: WardenRaw | null | undefined): ActivityEvent[] {
  const items = raw?.items
  if (!items) return []
  const boardItems = new Map((raw?.board?.items ?? []).map((i) => [String(i.event_id), i]))
  const out: ActivityEvent[] = []
  for (const [eventId, timeline] of Object.entries(items)) {
    const board = boardItems.get(eventId)
    const itemBag = bag(bag(timeline)?.['item'])
    const rawRepo = board?.repo ?? str(itemBag?.['repo'])
    const rawTitle = board?.title ?? str(itemBag?.['title'])
    // Cleaned once, where the item is read, so every row built from it renders a clean string.
    const repo = rawRepo === null ? null : stripShortcodes(rawRepo) || null
    const itemTitle = rawTitle === null ? null : stripShortcodes(rawTitle) || null
    const steps: Step[] = []
    for (const t of timeline.transitions ?? []) {
      const row = bag(t)
      const at = parseMs(str(row?.['at']))
      const to = str(row?.['to_state'])
      if (at === null || to === null || row?.['synthetic'] === true) continue
      steps.push({ ms: at, from: str(row?.['from_state']), to, dispatch: null })
    }
    for (const d of timeline.dispatches ?? []) {
      const row = bag(d)
      const at = parseMs(str(row?.['created_at']))
      if (at === null) continue
      const label = [str(row?.['tier']), str(row?.['status'])].filter(Boolean).join(' ')
      steps.push({ ms: at, from: null, to: null, dispatch: label || 'dispatch' })
    }
    steps.sort((a, b) => a.ms - b.ms)
    const bursts: Step[][] = []
    for (const step of steps) {
      const last = bursts.at(-1)
      if (last && step.ms - (last.at(-1)?.ms ?? 0) <= BURST_GAP_MS) last.push(step)
      else bursts.push([step])
    }
    for (const [i, burst] of bursts.entries()) {
      const path = pathOf(burst)
      const dispatches = burst.flatMap((s) => (s.dispatch ? [s.dispatch] : []))
      const verb = path ? 'moved' : 'dispatched'
      const shown = repo === null ? null : shortName(repo)
      const title = `${verb}${shown ? ` ${shown}` : ''} item`
      const outcome = [path, dispatches.length > 0 ? dispatches.join(', ') : '']
        .filter(Boolean)
        .join(' · ')
      out.push({
        key: `w-${eventId}-b${i}`,
        ms: burst.at(-1)?.ms ?? 0,
        actor: 'warden',
        title,
        ...(outcome ? { outcome } : {}),
        ...(itemTitle ? { detail: itemTitle } : {}),
        ...(shown !== repo
          ? { full: `warden ${verb} ${repo} item${outcome ? ` · ${outcome}` : ''}` }
          : {}),
      })
    }
  }
  return out
}

export function narrativeEvents(narratives: readonly Narrative[] | undefined): ActivityEvent[] {
  return (narratives ?? []).flatMap((n) => {
    const ms = parseMs(n.revisedAt)
    if (ms === null) return []
    const title = headlineOf(n.summary)
    const chip = shortName(n.project)
    return [
      {
        key: `n-${n.project}`,
        ms,
        actor: 'narrator' as const,
        title,
        chip,
        ...(chip !== n.project ? { full: `narrator ${title} · ${n.project}` } : {}),
      },
    ]
  })
}

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

export type ActivityGroup = { label: string; events: ActivityEvent[] }

/** Newest first, inside the horizon, day-grouped. `total` counts every row before the cap. */
export function activityStream(
  events: readonly ActivityEvent[],
  now: number,
): { groups: ActivityGroup[]; total: number } {
  const horizon = activityHorizon(now)
  const live = events
    .filter((e) => e.ms >= horizon && e.ms <= now)
    .map((e) => ({
      ...e,
      title: stripShortcodes(e.title),
      ...(e.detail !== undefined && { detail: stripShortcodes(e.detail) }),
    }))
    .toSorted((a, b) => b.ms - a.ms)
  const groups: ActivityGroup[] = []
  for (const e of live) {
    const label = dayLabel(e.ms, now)
    const last = groups.at(-1)
    if (last?.label === label) last.events.push(e)
    else groups.push({ label, events: [e] })
  }
  return { groups, total: live.length }
}

export const emptyStreamLabel = (now: number) =>
  `No events since ${clockTime(new Date(activityHorizon(now)).toISOString())} yesterday.`

// ── Freshness ────────────────────────────────────────────────────────────────────────────────

/** The `Live` pulse shows only while the newest push is younger than this. */
const LIVE_WITHIN_MS = 30 * MIN_MS

/** The loaded feeds older than {@link LIVE_WITHIN_MS}, each as `Name 45m old`; empty when every one is fresh. */
export function staleFeeds(
  feeds: readonly { name: string; receivedAt: string | null | undefined }[],
  now: number,
): string[] {
  return feeds.flatMap((f) => {
    const ms = parseMs(f.receivedAt)
    if (ms === null || now - ms < LIVE_WITHIN_MS) return []
    return [`${f.name} ${formatWaitDuration(now - ms)} old`]
  })
}

// ── Summary sentence ─────────────────────────────────────────────────────────────────────────

/** Sources behind the needs-you list: Warden and the agent snapshot. With none of them loaded the list is unknown, not empty. */
export const NEEDS_YOU_SOURCES = 2

export type HomeSummaryInput = {
  decisions: readonly Decision[]
  /** Sources whose feed is not loaded: the count then covers the rest, and the sentence says so. */
  unavailable: readonly string[]
}

export type HomeSummaryParts = { sentence: string; facts: string[] }

/**
 * The headline (count + oldest wait, or why it can't be told) and one fact under it: where the
 * waiting items sit. The fleet, the next meeting and recovery each have a strip cell of their own,
 * so the summary does not print them a second time.
 */
export function homeSummaryParts(s: HomeSummaryInput): HomeSummaryParts {
  const n = s.decisions.length
  const oldest = s.decisions.reduce<number | null>(
    (max, d) => (d.ageMs !== null && (max === null || d.ageMs > max) ? d.ageMs : max),
    null,
  )
  const gap = s.unavailable.length > 0 ? ` (${s.unavailable.join(' and ')} unavailable)` : ''
  const cantTell = s.unavailable.length >= NEEDS_YOU_SOURCES
  const sentence = cantTell
    ? `Can't tell — ${s.unavailable.join(' and ')} unavailable.`
    : n === 0
      ? `Nothing needs you${gap}.`
      : `${n} ${n === 1 ? 'item needs' : 'items need'} you${gap}${oldest === null ? '' : `, oldest ${formatWaitDuration(oldest)}`}.`
  const inWarden = s.decisions.filter((d) => d.source === 'warden').length
  const withAgents = n - inWarden
  const where = [
    inWarden > 0 ? `${inWarden} in Warden` : null,
    withAgents > 0 ? `${withAgents} with agents` : null,
  ].filter((part): part is string => part !== null)
  return { sentence, facts: cantTell ? [] : where }
}

// ── Agents strip ─────────────────────────────────────────────────────────────────────────────

/**
 * The agents cell's fact line: the busiest hour and how many of the hours that have a snapshot
 * had an agent working; hours with no snapshot are named, not counted as idle. `null` when no hour
 * has a snapshot. (A shade band of hourly counts answered neither.)
 */
export function fleetPulse(buckets: readonly HourBucket[], total: number | null): string | null {
  const peak = peakWorking(buckets)
  if (peak === null) return null
  const measured = buckets.filter((b) => b.working !== null).length
  const busy = buckets.filter((b) => (b.working ?? 0) > 0).length
  const gap = buckets.length - measured
  const unobserved = gap > 0 ? ` · ${gap} h no data` : ''
  const of = total === null ? '' : ` of ${total}`
  return peak.value === 0
    ? `none working in ${measured} h observed${unobserved}`
    : `peak ${peak.value}${of} at ${clockOf(peak.hourMs)} · working in ${busy} of ${measured} h${unobserved}`
}
