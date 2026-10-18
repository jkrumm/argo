import { addDays, startOfDay as startOfDayDate } from 'date-fns'
import { clockTime, dayLabel, headlineOf, noSnapshotText } from '../agents/model'
import type { Narrative } from '../../lib/queries/agents'
import type { WardenRaw } from '../../lib/queries/warden'
import type { Decision } from '../../lib/decisions'
import type { SourceClass } from '../../lib/queries/calendar'
import { ARROW, NBSP, formatDuration, withUnit } from '../../lib/format'
import { GARMIN_SYNC_HOURS, RECOVERY_DAYS } from '../garmin-health/model'
import { leadOf, subjectOf } from '../../lib/question-copy'
import { firstClause, oldestWaitSentence, stripShortcodes } from '../../lib/text'

export { GARMIN_SYNC_HOURS }

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

const pad2 = (n: number) => String(n).padStart(2, '0')

export const localKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

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
export function recoveryFooter({ mean, days, isToday }: RecoveryReading): string {
  const parts = [
    ...(mean === null ? [] : [`${withUnit(RECOVERY_DAYS, 'd')} mean${NBSP}${Math.round(mean)}`]),
    // `{n}/{total} d` is one unit-bound figure and the only break left falls before `observed`,
    // so a narrow footer breaks between phrases, never inside the fill fact.
    isToday
      ? `${days}/${withUnit(RECOVERY_DAYS, 'd')} observed`
      : `today fills after the next Garmin sync (every ${withUnit(GARMIN_SYNC_HOURS, 'h')})`,
  ]
  return parts.join(' · ')
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
  /** The subject; wraps at its spaces, never cut. */
  title: string
  /** The end of the sentence (a transition path, a dispatch): always rendered whole, never clipped. */
  outcome?: string
  /** The entity chip: a project (a Warden row names its repo in the sentence instead). */
  chip?: string
  /** A muted second line: the item's own title. */
  detail?: string
}

/** Where a remaining decision waits: Agents holds the agents and the human queue, Warden its items. */
const REST_PLACE = { '/agents': 'on Agents', '/warden': 'in Warden' } as const

/**
 * The show-more button for the `count` decisions beyond the cards, worded as the remainder (the
 * summary's facts count the whole list).
 */
export const restLabel = (href: keyof typeof REST_PLACE, count: number): string =>
  `${count} more ${REST_PLACE[href]}`

/** Rows older than the start of yesterday are history, not "today's stream". */
const activityHorizon = (now: number) => addDays(startOfDayDate(now), -1).getTime()

type Bag = Record<string, unknown>
const bag = (v: unknown): Bag | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : undefined
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Steps on one item closer together than this are one burst: one feed row, not one per step. */
const BURST_GAP_MS = 10 * MIN_MS

type Step = { ms: number; from: string | null; to: string | null; dispatch: string | null }

/** A state as one unbreakable phrase: `needs decision` never splits across lines. */
const stateLabel = (s: string) => s.replaceAll('_', NBSP)

/** Words of one phrase joined by no-break spaces, so a narrow row wraps between phrases, never inside one. */
const gluePhrase = (text: string): string => text.replace(/ +/g, NBSP)

/** `new → working`: where a burst started and where it ended; the steps between sit in the item's timeline. */
function pathOf(steps: readonly Step[]): string {
  const states: string[] = []
  const push = (s: string | null) => {
    if (s !== null && states.at(-1) !== s) states.push(stateLabel(s))
  }
  const first = steps.find((s) => s.to !== null)
  push(first?.from ?? null)
  for (const step of steps) push(step.to)
  const ends = states.length > 2 ? [states[0]!, states.at(-1)!] : states
  return ends.join(ARROW)
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
    // The cards' subject rule (`subjectOf`): shortcodes, a commit label and a monitor's `[…]` prefix are dropped, as on the Warden cards.
    const itemTitle = rawTitle === null ? null : subjectOf(rawTitle)
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
      const title = `${verb}${repo ? ` ${repo}` : ''} item`
      const outcome = [path, dispatches.map(gluePhrase).join(', ')]
        .filter(Boolean)
        .join(`${NBSP}· `)
      out.push({
        key: `w-${eventId}-b${i}`,
        ms: burst.at(-1)?.ms ?? 0,
        actor: 'warden',
        title,
        ...(outcome ? { outcome } : {}),
        ...(itemTitle ? { detail: itemTitle } : {}),
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
    return [
      {
        key: `n-${n.project}`,
        ms,
        actor: 'narrator' as const,
        title,
        chip: n.project,
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

/**
 * The activity card's line with nothing to count: the empty window when a feed loaded, then every
 * source that is unknown (`— reload to retry` only when one failed); with no feed and no cause
 * known, the no-snapshot wording.
 */
export function feedEmptyLine(input: {
  loaded: boolean
  failed: readonly string[]
  pending: readonly string[]
  now: number
}): string {
  const { loaded, failed, pending, now } = input
  const unknown = unknownPhrase(failed, pending)
  if (!loaded && unknown === '') return `${noSnapshotText()}.`
  const retry = failed.length > 0 ? ' — reload to retry' : ''
  return [loaded ? emptyStreamLabel(now) : null, unknown === '' ? null : `${unknown}${retry}.`]
    .filter(Boolean)
    .join(' ')
}

/** With a feed loaded and nothing in the window: the horizon, and where new events appear. */
export const emptyStreamLabel = (now: number) =>
  `No events since ${clockTime(new Date(activityHorizon(now)).toISOString())} yesterday — Warden, narrator and calendar events appear here.`

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
    return [`${f.name} ${formatDuration(now - ms)} old`]
  })
}

// ── Summary sentence ─────────────────────────────────────────────────────────────────────────

/** Sources behind the needs-you list: Warden and the agent snapshot. With none of them loaded the list is unknown, not empty. */
export const NEEDS_YOU_SOURCES = 2

export type HomeSummaryInput = {
  decisions: readonly Decision[]
  /** Sources whose read failed: the count then covers the rest, and the sentence says so. */
  unavailable: readonly string[]
  /** Sources still being read: unknown for now, never an empty inbox. */
  loading: readonly string[]
}

/** `Warden failed to load, Agents loading`: the one wording for sources the list cannot yet count. */
export function unknownPhrase(unavailable: readonly string[], loading: readonly string[]): string {
  return [
    ...(unavailable.length > 0 ? [`${unavailable.join(' and ')} failed to load`] : []),
    ...(loading.length > 0 ? [`${loading.join(' and ')} loading`] : []),
  ].join(', ')
}

/** Every source behind the needs-you list is unknown (failed or loading): the list can't be counted. */
export const allUnknown = (s: Pick<HomeSummaryInput, 'unavailable' | 'loading'>): boolean =>
  s.unavailable.length + s.loading.length >= NEEDS_YOU_SOURCES

export type HomeSummaryParts = { sentence: string; facts: string[] }

/** The sources behind the needs-you list, by the names the gap wording uses. */
const NEEDS_YOU_SOURCE_NAMES = ['Warden', 'Agents'] as const

/** The sources that answered: neither failed nor still loading. */
const knownSources = (s: Pick<HomeSummaryInput, 'unavailable' | 'loading'>): string[] =>
  NEEDS_YOU_SOURCE_NAMES.filter((n) => !s.unavailable.includes(n) && !s.loading.includes(n))

/**
 * The empty needs-you list's title: `Nothing needs you` only when every source settled OK; with one
 * unknown it speaks only for the source that answered, and with all unknown it can't tell.
 */
export function needsYouEmptyTitle(s: Pick<HomeSummaryInput, 'unavailable' | 'loading'>): string {
  if (allUnknown(s)) return s.unavailable.length === 0 ? 'Loading' : "Can't tell"
  const known = knownSources(s)
  return known.length === NEEDS_YOU_SOURCE_NAMES.length
    ? 'Nothing needs you'
    : `Nothing from ${known.join(' and ')} needs you`
}

/**
 * The headline (count + oldest wait, or why it can't be told) and one fact under it: where the
 * waiting items sit. The fleet, the next meeting and recovery each have a strip cell of their own,
 * so the summary does not print them a second time.
 */
export function homeSummaryParts(s: HomeSummaryInput): HomeSummaryParts {
  const phrase = unknownPhrase(s.unavailable, s.loading)
  if (allUnknown(s)) {
    return {
      sentence:
        s.unavailable.length === 0
          ? `Loading ${s.loading.join(' and ')}.`
          : `Can't tell — ${phrase}.`,
      facts: [],
    }
  }
  if (s.decisions.length === 0 && phrase !== '')
    return { sentence: `${needsYouEmptyTitle(s)}; ${phrase}.`, facts: [] }
  const gap = phrase === '' ? '' : ` (${phrase})`
  const ages = s.decisions.flatMap((d) => (d.ageMs === null ? [] : [d.ageMs]))
  const oldest = ages.length === 0 ? null : formatDuration(Math.max(...ages))
  const sentence = `${oldestWaitSentence(s.decisions.length, oldest)}${gap}.`
  const count = (source: Decision['source']) =>
    s.decisions.filter((d) => d.source === source).length
  const where = [
    [count('warden'), 'in Warden'],
    [count('agent'), 'with agents'],
    [count('queue'), 'in the human queue'],
  ].flatMap(([n, label]) => (n === 0 ? [] : [`${n} ${label}`]))
  // One source alone is the heading count already; the split only says something across two.
  return { sentence, facts: where.length < 2 ? [] : where }
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
