import type { AgentPart, AgentThread } from 'basalt-ui/agent'
import type { HermesThreadType } from '../../lib/queries/hermes'
import { APP_LOCALE } from '../../lib/format'
import { isThreadPersisted } from './threads-store'

// The pure half of the thread list: what a row says, which day group it sits in, which threads
// fold into the untitled disclosure, and the summary sentence. Counts are derived client-side from
// the loaded list, once, here (docs/design/hermes-chat.md "Copy").

export const THREAD_TYPES = [
  'todo',
  'podcast',
  'infra',
  'note',
  'research',
  'general',
] as const satisfies readonly HermesThreadType[]

export const TYPE_LABEL: Record<HermesThreadType, string> = {
  todo: 'Todo',
  podcast: 'Podcast',
  infra: 'Infra',
  note: 'Note',
  research: 'Research',
  general: 'General',
}

export type ThreadEntry = {
  id: string
  /** `null` = the server never titled it. */
  title: string | null
  summary: string | null
  type: HermesThreadType | null
  pinned: boolean
  streaming: boolean
  /** False for a chat minted locally that the server has no row for yet. */
  persisted: boolean
  createdAt: number
  updatedAt: number
}

export type GroupKey = 'pinned' | 'today' | 'week' | 'earlier'

export const GROUP_LABEL: Record<GroupKey, string> = {
  pinned: 'Pinned',
  today: 'Today',
  week: 'This week',
  earlier: 'Earlier',
}

const GROUP_ORDER: readonly GroupKey[] = ['pinned', 'today', 'week', 'earlier']
const DAY_MS = 86_400_000

function metaString(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** The first user line of a local-only chat — the stand-in title until the server names it. */
function firstUserText(thread: AgentThread<AgentPart>): string | null {
  for (const message of thread.messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim().length > 0) return part.text.trim()
    }
  }
  return null
}

/** Live (non-archived) threads of the store as list entries, newest activity first. */
export function toEntries(threads: readonly AgentThread<AgentPart>[]): ThreadEntry[] {
  return threads
    .filter((thread) => thread.meta?.['archived'] !== true)
    .map((thread) => {
      const type = thread.meta?.['type']
      return {
        id: thread.id,
        title: metaString(thread.meta, 'title'),
        summary: metaString(thread.meta, 'summary') ?? firstUserText(thread),
        type: typeof type === 'string' ? (type as HermesThreadType) : null,
        pinned: thread.meta?.['pinned'] === true,
        streaming: thread.status === 'streaming',
        persisted: isThreadPersisted(thread),
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      }
    })
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * A thread the disclosure row owns: never titled, and quiet. A chat that is streaming or not yet
 * persisted stays in the main list so its pulse and its first line stay visible.
 */
export function isUntitled(entry: ThreadEntry): boolean {
  return entry.title === null && entry.persisted && !entry.streaming
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function groupOf(entry: ThreadEntry, now: number): GroupKey {
  if (entry.pinned) return 'pinned'
  const today = startOfDay(now)
  if (entry.updatedAt >= today) return 'today'
  if (entry.updatedAt >= today - 6 * DAY_MS) return 'week'
  return 'earlier'
}

export type ThreadGroup = { key: GroupKey; label: string; rows: ThreadEntry[]; live: boolean }

export function groupEntries(entries: readonly ThreadEntry[], now: number): ThreadGroup[] {
  const buckets = new Map<GroupKey, ThreadEntry[]>()
  for (const entry of entries) {
    const key = groupOf(entry, now)
    buckets.set(key, [...(buckets.get(key) ?? []), entry])
  }
  return GROUP_ORDER.flatMap((key) => {
    const rows = buckets.get(key)
    if (rows === undefined) return []
    return [{ key, label: GROUP_LABEL[key], rows, live: rows.some((row) => row.streaming) }]
  })
}

export type ThreadView = {
  /** Every non-archived thread — the figure the summary and the `All` chip share. */
  total: number
  /** Titled rows after the type and search filters. */
  groups: ThreadGroup[]
  /** The fold: untitled threads, shown only when no filter narrows the list. */
  untitled: ThreadEntry[]
  /** Per type, over every non-archived thread. */
  typeCounts: Record<HermesThreadType, number>
}

export type ThreadFilter = { type: HermesThreadType | 'all'; query: string }

function matchesQuery(entry: ThreadEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return `${entry.title ?? ''} ${entry.summary ?? ''}`.toLowerCase().includes(needle)
}

export function buildView(
  entries: readonly ThreadEntry[],
  filter: ThreadFilter,
  now: number,
): ThreadView {
  const typeCounts = Object.fromEntries(THREAD_TYPES.map((type) => [type, 0])) as Record<
    HermesThreadType,
    number
  >
  for (const entry of entries) if (entry.type !== null) typeCounts[entry.type] += 1

  const narrowed = filter.type !== 'all' || filter.query.trim() !== ''
  const untitled = entries.filter(isUntitled)
  const titled = entries
    .filter((entry) => !isUntitled(entry))
    .filter((entry) => filter.type === 'all' || entry.type === filter.type)
    .filter((entry) => matchesQuery(entry, filter.query))

  return {
    total: entries.length,
    groups: groupEntries(titled, now),
    untitled: narrowed ? [] : untitled,
    typeCounts,
  }
}

const timeFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayFormat = new Intl.DateTimeFormat(APP_LOCALE, { day: 'numeric', month: 'short' })
const dayYearFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** `HH:mm` for today, `D Mon` for anything older. */
export function listTime(ms: number, now: number): string {
  return ms >= startOfDay(now) ? timeFormat.format(ms) : dayFormat.format(ms)
}

/** A start date: `D Mon`, with the year once it is not this year. */
export function startedDate(ms: number, now: number): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return (sameYear ? dayFormat : dayYearFormat).format(ms)
}

/** Wide: `Started {date} · last reply {time}` (the type is the chip beside the title). Compact, no chip: `{time} · {type}`. */
export function factsLine({
  entry,
  now,
  compact,
}: {
  entry: ThreadEntry
  now: number
  compact: boolean
}): string {
  const sameDay = startOfDay(entry.updatedAt) === startOfDay(entry.createdAt)
  const reply = sameDay ? timeFormat.format(entry.updatedAt) : listTime(entry.updatedAt, now)
  const type = entry.type === null ? null : TYPE_LABEL[entry.type]
  const parts = compact
    ? [reply, type]
    : [`Started ${startedDate(entry.createdAt, now)}`, `last reply ${reply}`]
  return parts.filter((part): part is string => part !== null).join(' · ')
}

export type ThreadSummary = {
  threads: number
  untitled: number
  pinned: number
  today: number
  /** `null` with no threads. */
  lastReply: string | null
}

export function summarize(entries: readonly ThreadEntry[], now: number): ThreadSummary {
  const today = startOfDay(now)
  const newest = entries.reduce<number | null>(
    (max, entry) => (max === null || entry.updatedAt > max ? entry.updatedAt : max),
    null,
  )
  return {
    threads: entries.length,
    untitled: entries.filter(isUntitled).length,
    pinned: entries.filter((entry) => entry.pinned).length,
    today: entries.filter((entry) => entry.updatedAt >= today).length,
    lastReply: newest === null ? null : listTime(newest, now),
  }
}

/** `{n} threads · {n} pinned · {n} today · last reply {time}`. */
export function summaryLine(summary: ThreadSummary): string {
  const parts = [
    `${summary.threads} ${summary.threads === 1 ? 'thread' : 'threads'}`,
    ...(summary.untitled > 0 ? [`${summary.untitled} untitled`] : []),
    `${summary.pinned} pinned`,
    `${summary.today} today`,
  ]
  if (summary.lastReply !== null) parts.push(`last reply ${summary.lastReply}`)
  return parts.join(' · ')
}

/** The disclosure row: `{n} untitled chats · oldest {age}`. `ageLabel` is the relative age. */
export function untitledLabel(count: number, oldestAge: string): string {
  return `${count} untitled ${count === 1 ? 'chat' : 'chats'} · oldest ${oldestAge}`
}

export function oldestUpdatedAt(entries: readonly ThreadEntry[]): number {
  return entries.reduce((min, entry) => Math.min(min, entry.updatedAt), Number.POSITIVE_INFINITY)
}
