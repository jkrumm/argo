import { format } from 'date-fns'
import type { AgentPart, AgentThread } from 'basalt-ui/agent'
import type { HermesThreadType } from '../../lib/queries/hermes'
import { NBSP } from '../../lib/format'
import { isThreadPersisted, THREADS_LIST_LIMIT } from './threads-store'

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
  archived: boolean
  streaming: boolean
  /** False for a chat minted locally that the server has no row for yet. */
  persisted: boolean
  createdAt: number
  updatedAt: number
}

type GroupKey = 'pinned' | 'today' | 'week' | 'earlier'

const GROUP_LABEL: Record<GroupKey, string> = {
  pinned: 'Pinned',
  today: 'Today',
  week: 'This week',
  earlier: 'Earlier',
}

const GROUP_ORDER: readonly GroupKey[] = ['pinned', 'today', 'week', 'earlier']

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

/** Every thread of the store (archived included) as list entries, newest activity first. */
export function toEntries(threads: readonly AgentThread<AgentPart>[]): ThreadEntry[] {
  return threads
    .map((thread) => {
      const type = thread.meta?.['type']
      return {
        id: thread.id,
        title: metaString(thread.meta, 'title'),
        summary: metaString(thread.meta, 'summary') ?? firstUserText(thread),
        type: typeof type === 'string' ? (type as HermesThreadType) : null,
        pinned: thread.meta?.['pinned'] === true,
        archived: thread.meta?.['archived'] === true,
        streaming: thread.status === 'streaming',
        persisted: isThreadPersisted(thread),
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      }
    })
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
}

/** A fresh persisted chat may still be waiting for its server title (the title pass is async). */
const TITLE_GRACE_MS = 60_000

/**
 * A thread the disclosure row owns: never titled, persisted, quiet and not fresh. A chat that is
 * streaming, pinned, not yet persisted or younger than the title grace stays in the main list, so
 * its pulse, its pin and its first line stay visible and "Delete all" cannot reach it.
 */
export function isUntitled(entry: ThreadEntry, now: number): boolean {
  return (
    entry.title === null &&
    entry.persisted &&
    !entry.streaming &&
    !entry.pinned &&
    now - entry.updatedAt >= TITLE_GRACE_MS
  )
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Midnight six days before today: the start of the 7-day window that includes today. */
function weekWindowStart(now: number): number {
  const d = new Date(startOfDay(now))
  d.setDate(d.getDate() - 6)
  return d.getTime()
}

function groupOf(entry: ThreadEntry, now: number): GroupKey {
  if (entry.pinned) return 'pinned'
  if (entry.updatedAt >= startOfDay(now)) return 'today'
  if (entry.updatedAt >= weekWindowStart(now)) return 'week'
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

type ThreadView = {
  /** Every non-archived thread: the figure the summary and the `All` chip share. */
  total: number
  /** The `All` chip: every non-archived thread matching the search query. */
  allCount: number
  /** Titled rows after the type and search filters (the archived ones under that filter). */
  groups: ThreadGroup[]
  /** The fold: untitled threads, shown only when no filter narrows the list. */
  untitled: ThreadEntry[]
  /** Per type, over the titled rows a chip reveals. */
  typeCounts: Record<HermesThreadType, number>
  /** Size of the fold, whatever the filter: the `Untitled` chip's count. */
  untitledCount: number
  /** Archived threads: the `Archived` chip's count. */
  archivedCount: number
}

type ThreadFilter = {
  type: HermesThreadType | 'all' | 'untitled' | 'archived'
  query: string
}

function matchesQuery(entry: ThreadEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return `${entry.title ?? ''} ${entry.summary ?? ''}`.toLowerCase().includes(needle)
}

/**
 * `entries` are the non-archived threads, `archived` the archived ones. Every count here is over
 * the rows the chip reveals AFTER the search query, so a chip never promises more than it shows.
 */
export function buildView({
  entries,
  archived,
  filter,
  now,
}: {
  entries: readonly ThreadEntry[]
  archived: readonly ThreadEntry[]
  filter: ThreadFilter
  now: number
}): ThreadView {
  const hit = (entry: ThreadEntry) => matchesQuery(entry, filter.query)
  const untitled = entries.filter((entry) => isUntitled(entry, now) && hit(entry))
  const titled = entries.filter((entry) => !isUntitled(entry, now) && hit(entry))
  const archivedHits = archived.filter(hit)
  const typeCounts = Object.fromEntries(THREAD_TYPES.map((type) => [type, 0])) as Record<
    HermesThreadType,
    number
  >
  for (const entry of titled) if (entry.type !== null) typeCounts[entry.type] += 1

  let rows: readonly ThreadEntry[]
  if (filter.type === 'untitled') rows = []
  else if (filter.type === 'archived') rows = archivedHits.map((e) => ({ ...e, pinned: false }))
  else rows = titled.filter((entry) => filter.type === 'all' || entry.type === filter.type)

  return {
    total: entries.length,
    allCount: titled.length + untitled.length,
    groups: groupEntries(rows, now),
    untitled: filter.type === 'all' || filter.type === 'untitled' ? untitled : [],
    typeCounts,
    untitledCount: untitled.length,
    archivedCount: archivedHits.length,
  }
}

const TIME_PATTERN = 'HH:mm'
const DAY_PATTERN = 'd MMM'
const DAY_YEAR_PATTERN = 'd MMM yyyy'

const timeOf = (ms: number): string => format(ms, TIME_PATTERN)

/** `HH:mm` for today, `D Mon` for anything older. */
export function listTime(ms: number, now: number): string {
  return ms >= startOfDay(now) ? timeOf(ms) : format(ms, DAY_PATTERN)
}

/** A start date: `D Mon`, with the year once it is not this year. */
export function startedDate(ms: number, now: number): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return format(ms, sameYear ? DAY_PATTERN : DAY_YEAR_PATTERN)
}

/** Parts of the facts line, joined by ` · ` at render. Wide: `Started {date}`, `last reply {time}` (the type is the chip beside the title). Compact, no chip: `last reply {time} · {type}`. */
export function factsParts({
  entry,
  now,
  compact,
}: {
  entry: ThreadEntry
  now: number
  compact: boolean
}): string[] {
  const sameDay = startOfDay(entry.updatedAt) === startOfDay(entry.createdAt)
  const reply = listTime(entry.updatedAt, now)
  const type = entry.type === null ? null : TYPE_LABEL[entry.type]
  const parts = compact
    ? [`last reply ${reply}`, type]
    : sameDay
      ? [
          `Started ${startedDate(entry.createdAt, now)} ${timeOf(entry.createdAt)}`,
          `last reply ${timeOf(entry.updatedAt)}`,
        ]
      : [`Started ${startedDate(entry.createdAt, now)}`, `last reply ${reply}`]
  return parts.filter((part): part is string => part !== null)
}

/**
 * The headline, over every thread (archived included): the one fact no group heading, chip, fold or
 * row time prints, with the figure it rests on: how many of all threads are replying. `null` with no
 * threads, where the empty state speaks.
 */
export function summaryHeadline(entries: readonly ThreadEntry[]): { sentence: string } | null {
  if (entries.length === 0) return null
  const running = entries.filter((entry) => entry.streaming).length
  const of = `${entries.length} ${entries.length === 1 ? 'thread' : 'threads'}`
  return {
    sentence:
      running === 0 ? `Nothing running in ${of}` : `Hermes is replying in ${running} of ${of}`,
  }
}

/** Every space unbreakable: a phrase that must never split across lines. */
const glue = (text: string): string => text.replaceAll(' ', NBSP)

/** The disclosure row: `Untitled · oldest {age}`. The count lives on the `Untitled` chip only. */
export function untitledLabel(oldestAge: string): string {
  return `Untitled · oldest ${glue(oldestAge)}`
}

function oldestOf(entries: readonly ThreadEntry[], field: 'createdAt' | 'updatedAt'): number {
  return entries.reduce((min, entry) => Math.min(min, entry[field]), Number.POSITIVE_INFINITY)
}

export function oldestUpdatedAt(entries: readonly ThreadEntry[]): number {
  return oldestOf(entries, 'updatedAt')
}

/**
 * The line under the last row of an unfiltered list. The list request is capped, so how far back
 * the loaded part reaches is stated only when the server's `total` (or, without it, a list at the
 * cap) says more exist; a complete list needs no note (the fold's `oldest {age}` and the rows' own
 * start dates already say how far back it reaches).
 */
export function listEndNote(
  entries: readonly ThreadEntry[],
  archivedCount: number,
  now: number,
  serverTotal: number | null,
  limit: number = THREADS_LIST_LIMIT,
): string | null {
  if (entries.length === 0) return null
  const loaded = entries.length + archivedCount
  const capped = serverTotal === null ? loaded >= limit : serverTotal > loaded
  if (!capped) return null
  const back = startedDate(oldestOf(entries, 'updatedAt'), now)
  return serverTotal === null
    ? `The newest ${loaded} threads, back to ${back}`
    : `${loaded} of ${serverTotal} threads, back to ${back}`
}

const SUMMARY_MAX_CHARS = 110
/** Two lines of the phone's narrow body column; a longer cut would be clipped mid-word by the line clamp. */
const SUMMARY_MAX_CHARS_COMPACT = 52

/**
 * A summary cut at a word boundary with an ellipsis; short text passes through with whitespace
 * collapsed. Only a single token longer than `max` is cut mid-word, as there is no boundary to use.
 */
export function clampAtWord(text: string, max: number = SUMMARY_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  const atWord = (space > 0 ? cut.slice(0, space) : '').replace(/[\s,;:.\-–—]+$/, '')
  return `${atWord === '' ? flat.slice(0, max) : atWord}…`
}

/** A row title on the phone is cut at a word; the CSS ellipsis stays as the backstop on wide rows. */
const TITLE_MAX_CHARS_COMPACT = 26

export function titleExcerpt(title: string, compact: boolean): string {
  return compact ? clampAtWord(title, TITLE_MAX_CHARS_COMPACT) : title
}

/** A row's summary cut for the layout: the phone's narrow column takes fewer characters. */
export function summaryExcerpt(summary: string, compact: boolean): string {
  return clampAtWord(summary, compact ? SUMMARY_MAX_CHARS_COMPACT : SUMMARY_MAX_CHARS)
}

/**
 * The empty list's one line. With every thread archived and no filter set, that is the fact (the
 * `Archived` chip lists them); otherwise a filter or search emptied the list.
 */
export function emptyNote(input: { threads: number; active: number; filtered: boolean }): string {
  if (input.threads === 0) return 'No threads yet. Type below to start.'
  if (input.active === 0 && !input.filtered) return 'All threads archived'
  return 'No thread matches this filter.'
}
