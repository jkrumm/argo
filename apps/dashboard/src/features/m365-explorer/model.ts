import { differenceInCalendarDays, isToday } from 'date-fns'

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
  chatType: ChatType
  memberCount: number
  lastUpdatedAt: string | null
  webUrl: string | null
}

export type RecencyGroup = 'Today' | 'This week' | 'Earlier'
const GROUP_ORDER: readonly RecencyGroup[] = ['Today', 'This week', 'Earlier']

export function recencyOf(iso: string | null, now: Date): RecencyGroup {
  if (!iso) return 'Earlier'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  if (isToday(d)) return 'Today'
  return differenceInCalendarDays(now, d) < 7 ? 'This week' : 'Earlier'
}

/** Rows (already newest-first from the API) bucketed into the three recency groups; empty groups dropped. */
export function groupByRecency(
  rows: readonly ChatRow[],
  now: Date,
): Array<{ group: RecencyGroup; rows: ChatRow[] }> {
  const buckets = new Map<RecencyGroup, ChatRow[]>()
  for (const row of rows) {
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

/** The labelable total: chats plus every channel; null while any team's channel list is still loading. */
export function labelableTotal(
  chatCount: number,
  channelCounts: ReadonlyArray<number | null>,
): number | null {
  if (channelCounts.some((n) => n === null)) return null
  return chatCount + channelCounts.reduce<number>((a, n) => a + (n ?? 0), 0)
}

const FALLBACK_TIME = ''

export function formatTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return FALLBACK_TIME
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return FALLBACK_TIME
  if (isToday(d)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (differenceInCalendarDays(now, d) < 7) {
    return d.toLocaleDateString([], { weekday: 'short' })
  }
  return d.toLocaleDateString([], { month: 'short', day: '2-digit' })
}

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return FALLBACK_TIME
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return FALLBACK_TIME
  return d.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
