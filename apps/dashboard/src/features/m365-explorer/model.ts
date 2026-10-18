import { differenceInCalendarDays, format, isSameDay } from 'date-fns'

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
function timeOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

function recencyOf(iso: string | null, now: Date): RecencyGroup {
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

const KIND_TYPE = {
  oneOnOne: 'oneOnOne',
  group: 'group',
  meeting: 'meeting',
  other: 'unknownFutureValue',
} as const satisfies Record<string, ChatType>

/**
 * The kinds that have chats, in reading order, for the Chats cell: a zero kind is not a fact.
 * `label` is the kind's word (the bar segment), `text` the counted noun (`2 meetings`, `1 group chat`).
 */
export function chatKindParts(counts: ReturnType<typeof chatKindCounts>): Array<{
  key: keyof ReturnType<typeof chatKindCounts>
  label: string
  text: string
  value: number
}> {
  return (Object.keys(KIND_TYPE) as Array<keyof typeof KIND_TYPE>).flatMap((key) => {
    const value = counts[key]
    if (value === 0) return []
    const label = CHAT_TYPE_LABEL[KIND_TYPE[key]]
    const noun = key === 'meeting' ? label : `${label} chat`
    return [{ key, label, text: plural(value, noun), value }]
  })
}

export function chatKindCounts(rows: ReadonlyArray<{ chatType: ChatType }>): {
  oneOnOne: number
  group: number
  meeting: number
  /** Any kind the API adds later, so the kinds always sum to the row count. */
  other: number
} {
  const counts = { oneOnOne: 0, group: 0, meeting: 0, other: 0 }
  for (const r of rows) {
    if (r.chatType === 'oneOnOne') counts.oneOnOne++
    else if (r.chatType === 'group') counts.group++
    else if (r.chatType === 'meeting') counts.meeting++
    else counts.other++
  }
  return counts
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
  if (isSameDay(d, now)) return format(d, 'HH:mm')
  return format(d, differenceInCalendarDays(now, d) < 7 ? 'EEE dd' : 'dd MMM')
}

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return FALLBACK_TIME
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return FALLBACK_TIME
  return format(d, 'dd MMM, HH:mm')
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What the strip counts over, in words: the newest-N chat window when the list is capped, plus channels. */
export function sourceListName(chats: number, capped: boolean): string {
  return capped ? `newest ${chats} chats and channels` : 'chats and channels'
}

/**
 * The labeled cell's footer: the list the count ranges over, and, when labels sit on sources the
 * list cannot place, how many, naming the same list and why they are missing from it.
 */
export function labeledBasis(c: Coverage, list: string): string {
  if (c.outside === 0) return `across the ${list}`
  return `${plural(c.outside, 'more label')} on sources not in the ${list}`
}

/** The phone Sources pane's heading: the pane's name only; the tabs and cells print the counts. */
export function sourcesTitle(view: 'chats' | 'teams' | 'feed'): string {
  return view === 'feed' ? 'Labeled sources' : view === 'chats' ? 'Chats' : 'Teams'
}

/**
 * The page's opening: the newest chat stamp. Every count (the recency groups, the labeled count, the
 * chat and team totals, the tag count) is printed once each elsewhere, so none repeats here.
 */
export function headlineOf(h: {
  /** Pre-formatted stamp of the newest chat, or null when there is none. */
  latest: string | null
}): { sentence: string } {
  return { sentence: h.latest === null ? 'No chat activity yet' : `Latest activity ${h.latest}` }
}

/** How many messages a record fetches; the pane's heading never states it (it is a request cap, not what renders). */
export const MESSAGE_TOP = 20

/** The phone Section title: a fact about the pane in view, never the tab's own name. */
export function sectionTitleFor(input: {
  pane: 'sources' | 'labeled' | 'detail'
  view: 'chats' | 'teams' | 'feed'
  tag: string
  open: boolean
}): string {
  switch (input.pane) {
    case 'sources':
      return sourcesTitle(input.view)
    case 'labeled':
      return input.tag === '' || input.tag === LABELED_FILTER ? 'Grouped by tag' : input.tag
    case 'detail':
      if (input.view === 'feed') return 'Agent feed'
      return input.open ? 'Messages' : 'Nothing open'
  }
}

/**
 * The team holding the most channels (first wins a tie). `null` until every team has loaded, so a
 * partial list never names a winner, and `null` when no team has a channel.
 */
export function largestTeam(
  teams: ReadonlyArray<{ name: string; state: ChannelState; channels: number }>,
): { name: string; channels: number } | null {
  let best: { name: string; channels: number } | null = null
  for (const t of teams) {
    if (t.state !== 'loaded') return null
    if (t.channels > 0 && (best === null || t.channels > best.channels)) {
      best = { name: t.name, channels: t.channels }
    }
  }
  return best
}

/** The labeled pane's own title: the tag in view, or the whole set for All and the Labeled chip. */
export function labeledPaneTitle(tag: string): string {
  return tag === '' || tag === LABELED_FILTER ? 'Labeled sources' : `Labeled sources · ${tag}`
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

/**
 * Drops tags with no rows in this view — noise — except the `active` filter, and except while the
 * row set is incomplete (`all === null`: channel lists still loading), when a zero is not yet a fact.
 */
export function visibleChipCounts(counts: ChipCounts, active: string): ChipCounts {
  if (counts.all === null) return counts
  return { ...counts, tags: counts.tags.filter(([t, n]) => n > 0 || t === active) }
}

/** A persisted tag filter only survives while the tag still exists. */
export function validTag(tag: string, tags: readonly string[]): string {
  return tag === '' || tag === LABELED_FILTER || tags.includes(tag) ? tag : ''
}

/** The channels cell's footer: failed, loading, empty and populated are different facts. */
export function channelsFooter(input: {
  channels: number | null
  largest: { name: string; channels: number } | null
  failed: number
}): string {
  const { channels, largest, failed } = input
  if (failed > 0) return `${plural(failed, 'team')} failed to load`
  if (channels === null) return 'still loading'
  if (largest === null) return 'no channels'
  return `most in ${largest.name}, ${plural(largest.channels, 'channel')}`
}
