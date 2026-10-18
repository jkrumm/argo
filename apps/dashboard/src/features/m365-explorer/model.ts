import { differenceInCalendarDays, format, isSameDay } from 'date-fns'
import { NBSP, withUnit } from '../../lib/format'

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
  oneOnOne: 'direct',
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
 * The kinds that have chats, biggest first, for the Chats cell: a zero kind is not a fact.
 * `label` is the kind's word (the bar segment), `text` the counted noun (`2 meetings`, `1 group chat`).
 */
export function chatKindParts(counts: ReturnType<typeof chatKindCounts>): Array<{
  key: keyof ReturnType<typeof chatKindCounts>
  label: string
  /** The kind's noun, counted (`chats`, `meetings`), singular at one. */
  noun: string
  text: string
  value: number
}> {
  const parts = (Object.keys(KIND_TYPE) as Array<keyof typeof KIND_TYPE>).flatMap((key) => {
    const value = counts[key]
    if (value === 0) return []
    const label = CHAT_TYPE_LABEL[KIND_TYPE[key]]
    const one = key === 'meeting' ? label : `${label} chat`
    return [{ key, label, noun: noun(value, one), text: plural(value, one), value }]
  })
  // Biggest first (reading order on a tie; sort is stable), so the bar, the hero and the footer agree.
  return parts.sort((a, b) => b.value - a.value)
}

/**
 * The Chats cell: the leading kind (most chats, reading order on a tie) is the hero, the other kinds
 * are the footer, so no figure prints twice and the total stays the `All` chip's. `hero` is `null`
 * without chats.
 */
export function chatsStat(counts: ReturnType<typeof chatKindCounts>): {
  hero: { value: string; unit: string } | null
  footer: string | null
} {
  const parts = chatKindParts(counts)
  const lead = parts.reduce<(typeof parts)[number] | null>(
    (best, p) => (best === null || p.value > best.value ? p : best),
    null,
  )
  if (lead === null) return { hero: null, footer: 'no chats' }
  const rest = parts.filter((p) => p !== lead)
  return {
    hero: { value: String(lead.value), unit: lead.noun },
    footer: rest.length === 0 ? null : rest.map((p) => p.text).join(' · '),
  }
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

function noun(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${noun(n, one, many)}`
}

/** How many chats the list request asks for. */
export const CHATS_TOP = 50

/** The list hit its request cap, so older chats may be missing. */
export const chatsCapped = (chats: number): boolean => chats >= CHATS_TOP

/**
 * What the strip counts over, in words: the newest-N chat window when the list is capped, plus the
 * channels (`all` only once every team has loaded, so a loading or failed team never reads as covered).
 */
export function sourceListName(chats: number, capped: boolean, channelsComplete = true): string {
  const channels = channelsComplete ? 'all channels' : 'channels'
  return capped ? `newest ${chats} chats and ${channels}` : 'chats and channels'
}

/**
 * The labeled cell's footer: the list the count ranges over, and, when labels sit on sources the
 * list cannot place, how many and the hedged cause. Channels are never age-windowed, so only a
 * capped list can say `older`.
 */
export function labeledBasis(c: Coverage, list: { chats: number; capped: boolean }): string {
  const complete = c.loading + c.failed === 0
  if (c.outside === 0) return `across the ${sourceListName(list.chats, list.capped, complete)}`
  const more = plural(c.outside, 'more label')
  if (list.capped) return `${more} on chats outside the newest ${list.chats}, or gone from the list`
  return `${more} on sources gone from the chat and channel list`
}

/** The phone Sources pane's heading: the pane's name only; the tabs and cells print the counts. */
export function sourcesTitle(view: 'chats' | 'teams' | 'feed'): string {
  return view === 'feed' ? 'Feed sources' : view === 'chats' ? 'Chats' : 'Teams'
}

/** `3–17 Oct` within a month, `28 Sep – 17 Oct` across two, `17 Oct 2025 – 3 Oct 2026` across years. Day↔month is glued. */
function spanDates(from: number, to: number): string {
  const day = (ms: number, pattern: string) => format(ms, pattern).replace(' ', NBSP)
  if (format(from, 'yyyy') !== format(to, 'yyyy'))
    return `${day(from, 'd MMM yyyy')} – ${day(to, 'd MMM yyyy')}`
  return format(from, 'MMM') === format(to, 'MMM')
    ? `${format(from, 'd')}–${day(to, 'd MMM')}`
    : `${day(from, 'd MMM')} – ${day(to, 'd MMM')}`
}

/**
 * The page's opening: how many days the loaded chats span. Rows print their own times, but not the
 * window's width, which is what tells a reader how far back the list can answer. A capped list says
 * so (`Newest {n} chats span {d} d`), since the span then belongs to the newest slice only.
 */
export function headlineOf(h: {
  /** Each chat's last activity (ISO), newest or not; missing stamps are skipped. */
  times: ReadonlyArray<string | null>
  capped: boolean
}): { sentence: string } {
  const stamps = h.times.map(timeOf).filter(Number.isFinite)
  if (stamps.length === 0) return { sentence: 'No chat activity yet' }
  const newest = Math.max(...stamps)
  const oldest = Math.min(...stamps)
  const days = differenceInCalendarDays(newest, oldest)
  const lead = h.capped ? `Newest ${stamps.length} chats` : 'Chats'
  return {
    sentence:
      days === 0
        ? `${lead} all from ${format(newest, 'd MMM').replace(' ', NBSP)}`
        : `${lead} span ${withUnit(days, 'd')}, ${spanDates(oldest, newest)}`,
  }
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
      return input.tag === '' || input.tag === LABELED_FILTER ? 'Chats and channels' : input.tag
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
