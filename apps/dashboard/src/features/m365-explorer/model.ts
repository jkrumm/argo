import { differenceInCalendarDays, isSameDay } from 'date-fns'
import { APP_LOCALE } from '../../lib/format'

export type LabelKind = 'chat' | 'channel'
export type ChatType = 'oneOnOne' | 'group' | 'meeting' | 'unknownFutureValue'

/** Tag-filter value for "every labeled source" — no real tag can collide with a leading `*`. */
export const LABELED_FILTER = '*'

export type SourceRef =
  | { kind: 'chat'; chatId: string; displayName: string }
  | { kind: 'channel'; teamId: string; channelId: string; displayName: string; teamName: string }

export const chatSourceId = (chatId: string): string => `chat:${chatId}`
export const channelSourceId = (teamId: string, channelId: string): string =>
  `channel:${teamId}:${channelId}`

export function sourceIdFor(ref: SourceRef): string {
  return ref.kind === 'chat' ? chatSourceId(ref.chatId) : channelSourceId(ref.teamId, ref.channelId)
}

/** `channel:<teamId>:<channelId>` → its parts; null for anything else. */
export function parseChannelId(sourceId: string): { teamId: string; channelId: string } | null {
  const [kind, teamId, ...rest] = sourceId.split(':')
  const channelId = rest.join(':')
  if (kind !== 'channel' || !teamId || !channelId) return null
  return { teamId, channelId }
}

export function chatTitle(chat: {
  topic: string | null
  members: ReadonlyArray<{ name: string }>
}): string {
  if (chat.topic) return chat.topic
  const names = chat.members
    .map((m) => m.name)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')
  return names || '(no topic)'
}

export const CHAT_TYPE_LABEL: Record<ChatType, string> = {
  oneOnOne: '1:1',
  group: 'group',
  meeting: 'meeting',
  unknownFutureValue: 'other',
}

export type ChatRow = {
  ref: Extract<SourceRef, { kind: 'chat' }>
  /** Topic plus every member name, lower-cased, for search. */
  searchText: string
  chatType: ChatType
  memberCount: number
  lastUpdatedAt: string | null
  webUrl: string | null
}

export type RecencyGroup = 'Today' | 'Last 7 days' | 'Earlier'
const GROUP_ORDER: readonly RecencyGroup[] = ['Today', 'Last 7 days', 'Earlier']

/** Epoch ms of an ISO string; unparseable or missing sorts last. */
export function timeOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

export function recencyOf(iso: string | null, now: Date): RecencyGroup {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  if (isSameDay(d, now)) return 'Today'
  return differenceInCalendarDays(now, d) < 7 ? 'Last 7 days' : 'Earlier'
}

/** Rows (already newest-first from the API) bucketed into the three recency groups; empty groups dropped. */
export function groupByRecency(
  rows: readonly ChatRow[],
  now: Date,
): Array<{ group: RecencyGroup; rows: ChatRow[] }> {
  const buckets = new Map<RecencyGroup, ChatRow[]>()
  const newestFirst = rows.toSorted((a, b) => timeOf(b.lastUpdatedAt) - timeOf(a.lastUpdatedAt))
  for (const row of newestFirst) {
    const g = recencyOf(row.lastUpdatedAt, now)
    buckets.set(g, [...(buckets.get(g) ?? []), row])
  }
  return GROUP_ORDER.flatMap((group) => {
    const list = buckets.get(group)
    return list ? [{ group, rows: list }] : []
  })
}

export function chatKindCounts(rows: ReadonlyArray<{ chatType: ChatType }>): {
  oneOnOne: number
  group: number
  meeting: number
} {
  let oneOnOne = 0
  let group = 0
  let meeting = 0
  for (const r of rows) {
    if (r.chatType === 'oneOnOne') oneOnOne++
    else if (r.chatType === 'group') group++
    else if (r.chatType === 'meeting') meeting++
  }
  return { oneOnOne, group, meeting }
}

export type LabelLite = {
  sourceId: string
  kind: LabelKind
  label: string
  displayName: string | null
  notes: string | null
}

/** Tags by source count, biggest first (ties by name so the chip order is stable). */
export function tagCountsOf(labels: readonly LabelLite[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const l of labels) m.set(l.label, (m.get(l.label) ?? 0) + 1)
  return [...m.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function labelsByTag(
  labels: readonly LabelLite[],
): Array<{ tag: string; rows: LabelLite[] }> {
  return tagCountsOf(labels).map(([tag]) => ({
    tag,
    rows: labels.filter((l) => l.label === tag),
  }))
}

/** Does a labeled-state filter keep this source? `''` keeps everything. */
export function matchesTag(tag: string, labelOf: { label: string } | undefined): boolean {
  if (tag === '') return true
  if (tag === LABELED_FILTER) return labelOf !== undefined
  return labelOf?.label === tag
}

export type ChannelState = 'loading' | 'loaded' | 'failed'

export type Coverage = {
  /** Chats + loaded channels; a lower bound while a team is loading or failed. */
  total: number
  /** Labels whose source is inside the loaded set — never more than `total`. */
  labeled: number
  /** Labels pointing at a chat or channel outside the loaded set. */
  outside: number
  loading: number
  failed: number
}

/** The labelable universe and how much of it is labeled, counted over the SAME loaded ids. */
export function coverageOf(input: {
  chatIds: readonly string[]
  channels: ReadonlyArray<{ teamId: string; state: ChannelState; ids: readonly string[] }>
  labels: readonly LabelLite[]
}): Coverage {
  const known = new Set<string>(input.chatIds.map(chatSourceId))
  let loading = 0
  let failed = 0
  for (const t of input.channels) {
    if (t.state === 'loading') loading++
    else if (t.state === 'failed') failed++
    for (const id of t.ids) known.add(channelSourceId(t.teamId, id))
  }
  const labeled = input.labels.filter((l) => known.has(l.sourceId)).length
  // Labels on channels of a team that has not loaded cannot be judged yet.
  const unresolved = loading + failed > 0
  const outside = unresolved ? 0 : input.labels.length - labeled
  return { total: known.size, labeled, outside, loading, failed }
}

const FALLBACK_TIME = ''

export function formatTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return FALLBACK_TIME
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return FALLBACK_TIME
  if (isSameDay(d, now))
    return d.toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' })
  if (differenceInCalendarDays(now, d) < 7) {
    return d.toLocaleDateString(APP_LOCALE, { weekday: 'short', day: '2-digit' })
  }
  return d.toLocaleDateString(APP_LOCALE, { month: 'short', day: '2-digit' })
}

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return FALLBACK_TIME
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return FALLBACK_TIME
  return d.toLocaleString(APP_LOCALE, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export type ChipCounts = {
  /** Rows the view lists unfiltered; null while unknown. */
  all: number | null
  labeled: number
  tags: Array<[string, number]>
}

/** Chip counts for ONE view: every figure counts the rows that view would show for that chip. */
export function chipCounts(
  tags: readonly string[],
  rows: ReadonlyArray<{ label: string | undefined }>,
  all: number | null,
): ChipCounts {
  return {
    all,
    labeled: rows.filter((r) => r.label !== undefined).length,
    tags: tags.map((t) => [t, rows.filter((r) => r.label === t).length]),
  }
}

/** A persisted tag filter only survives while the tag still exists. */
export function validTag(tag: string, tags: readonly string[]): string {
  return tag === '' || tag === LABELED_FILTER || tags.includes(tag) ? tag : ''
}
