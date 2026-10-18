import type {
  OverviewAgent,
  OverviewProject,
  OverviewRecord,
  OverviewSnapshot,
  OverviewSummary,
  HistoryPoint,
} from '../../lib/queries/agents'

// Presentation vocabulary for the agents page. The STATE and RECOMMENDATION
// enums are agent-gateway's (server/lib/agents.ts); Argo only maps them to a label,
// a Mantine hue and the same glyph the herdr overview pane prints, so the
// phone pane and this page read identically.

export type AgentState = OverviewAgent['state']

export const STATE_LABEL: Record<AgentState, string> = {
  needs_you: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  stale: 'Stale',
  done: 'Done',
  unknown: 'Unknown',
}

/** A snapshot older than this is a feed that stopped, not a quiet machine. */
export const STALE_AFTER_MS = 30 * 60 * 1000

export type AgentRow = OverviewAgent & { project: string }

/**
 * One flat row per agent. A producer may send a flattened `agents[]` (each
 * carrying `project`); otherwise the rows come from `projects[].agents[]`,
 * already sorted most-urgent-first by agent-gateway.
 */
export function flattenAgents(snapshot: OverviewSnapshot | undefined): AgentRow[] {
  if (!snapshot) return []
  if (snapshot.agents && snapshot.agents.length > 0) {
    return snapshot.agents.map((a) => ({ ...a, project: a.project ?? '—' }))
  }
  return (snapshot.projects ?? []).flatMap((p) =>
    p.agents.map((a) => ({ ...a, project: a.project ?? p.name })),
  )
}

export function snapshotAgeMs(latest: OverviewRecord | null, now = Date.now()): number | null {
  if (!latest) return null
  return Math.max(0, now - Date.parse(latest.receivedAt))
}

// Wait-duration verdicts — how long the current `needs_you` agents have been waiting. The six old
// hero tiles never carried this: `needsYou: 1` reads identically whether that one item has waited
// 5 minutes or 21 days.

/** Past this, an "Oldest wait" reading escalates from calm to `warn`. */
export const OLDEST_WAIT_WARN_MS = 24 * 60 * 60 * 1000

/** Past this, a `needs_you` item is not live, it's abandoned — `warn` becomes `bad` on the tile,
 * and `NeedsYouSection` separates it out with its own label (the concrete case: a herdr pane
 * blocked on a dialog for 21 days, re-announced to Slack ~35 times). */
export const ABANDONED_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Human wait duration — `"21d 4h"`, `"5h 12m"`, `"42m"`. basalt's own `duration()` format
 * (`basalt-ui/format`) only carries hours/minutes, so the concrete case that motivated this tile —
 * an agent blocked 21 days — would read as `"504h 00m"`, not a duration anyone reads at a glance.
 * A non-finite or negative value prints `"—"`.
 */
export function formatWaitDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalMinutes = Math.round(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export type OldestWait = { ms: number; project: string }

/**
 * The longest any `needs_you` agent has been waiting, anchored on its own `lastActivityAt` — the
 * same clock `NeedsYouSection` and the table's "Last activity" column already read. `null` when no
 * `needs_you` agent carries a timestamp, so the "Oldest wait" tile can render "—" instead of a
 * false zero.
 */
export function oldestNeedsYouWait(agents: AgentRow[], now = Date.now()): OldestWait | null {
  let oldest: OldestWait | null = null
  for (const agent of agents) {
    if (agent.state !== 'needs_you' || agent.lastActivityAt == null) continue
    const ms = Math.max(0, now - agent.lastActivityAt)
    if (oldest === null || ms > oldest.ms) oldest = { ms, project: agent.project }
  }
  return oldest
}

/** Whether a `needs_you` agent has waited past {@link ABANDONED_AFTER_MS} — the predicate
 * `NeedsYouSection` uses to split the abandoned items out from the live ones. */
export function isAbandonedWait(agent: AgentRow, now = Date.now()): boolean {
  if (agent.state !== 'needs_you' || agent.lastActivityAt == null) return false
  return now - agent.lastActivityAt > ABANDONED_AFTER_MS
}

/** Epoch ms of an ISO timestamp, `null` when absent or unparseable. */
const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** One count's trend over the history window. A point without a summary or a finite count is omitted, not plotted as 0. */
export function trendSeries(
  history: HistoryPoint[] | undefined,
  key: 'needsYou' | 'working',
): number[] {
  return (history ?? []).flatMap((p) => {
    const n = p.summary?.[key]
    return isCount(n) ? [n] : []
  })
}

// ── Fleet by state ───────────────────────────────────────────────────────────────────────────

/** Segment order of the fleet meter. `dispatch` is a source count that overlaps working/done, so it is never a part. */
const FLEET_STATES = ['working', 'needs_you', 'idle', 'stale', 'done'] as const
type SummaryState = (typeof FLEET_STATES)[number]
export type FleetState = SummaryState | 'unknown'

export type FleetPart = { key: FleetState; label: string; value: number }

/** Agents whose state is `unknown` or none of the five the summary counts. */
export const countUnknownAgents = (agents: readonly AgentRow[]): number =>
  agents.filter((a) => !(FLEET_STATES as readonly string[]).includes(a.state)).length

const summaryKey = (key: SummaryState) => (key === 'needs_you' ? 'needsYou' : key)

/**
 * The fleet in fixed order, `total` their sum so captions always add up. `unknownAgents` (agents
 * whose state is none of the five) rides as a sixth part only when present, so the total matches
 * the agent roster. `null` when the snapshot carries no summary or only part of it: an unreported
 * count is unknown, never a measured zero.
 */
export function fleetParts(
  summary: OverviewSummary | undefined,
  unknownAgents = 0,
): { parts: FleetPart[]; total: number } | null {
  if (!summary) return null
  const counts = FLEET_STATES.map((key) => summary[summaryKey(key)])
  if (!counts.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const parts: FleetPart[] = FLEET_STATES.map((key, i) => ({
    key,
    label: STATE_LABEL[key].toLowerCase(),
    value: Math.max(0, counts[i] ?? 0),
  }))
  if (unknownAgents > 0) parts.push({ key: 'unknown', label: 'unknown', value: unknownAgents })
  return { parts, total: parts.reduce((sum, p) => sum + p.value, 0) }
}

/**
 * The one fleet fact the meter does not show: how long the longest-running working agent has been
 * up. `null` when nothing is working, so the cell has no footer rather than a filler one.
 */
export const fleetFact = (longestRunMs: number | null): string | null =>
  longestRunMs === null ? null : `longest run ${formatWaitDuration(longestRunMs)}`

// ── Needs-you trend ──────────────────────────────────────────────────────────────────────────

export type Peak = { value: number; atMs: number }

/** The highest `needsYou` in the window and, among ties, the latest time it was seen. `null` when no point carries a summary. */
export function peakNeedsYou(history: HistoryPoint[] | undefined): Peak | null {
  let peak: Peak | null = null
  for (const p of history ?? []) {
    const value = p.summary?.needsYou
    const atMs = parseMs(p.receivedAt)
    if (!isCount(value) || atMs === null) continue
    if (peak === null || value > peak.value || (value === peak.value && atMs > peak.atMs))
      peak = { value, atMs }
  }
  return peak
}

/** Hours of the window in which at least one snapshot showed an item waiting; `null` when no hour carries data. */
export function hoursWithNeedsYou(
  history: HistoryPoint[] | undefined,
  hours: number,
  now: number,
): number | null {
  const endHour = Math.floor(now / 3_600_000) * 3_600_000
  const startHour = endHour - (hours - 1) * 3_600_000
  const seen = new Set<number>()
  const waiting = new Set<number>()
  for (const p of history ?? []) {
    const n = p.summary?.needsYou
    const atMs = parseMs(p.receivedAt)
    if (!isCount(n) || atMs === null) continue
    const hour = Math.floor(atMs / 3_600_000) * 3_600_000
    if (hour < startHour || hour > endHour) continue
    seen.add(hour)
    if (n > 0) waiting.add(hour)
  }
  return seen.size === 0 ? null : waiting.size
}

/** The needs-you cell's footer: how many of the window's hours had something waiting. */
export function needsYouWindowFact(waitingHours: number | null, hours: number): string {
  if (waitingHours === null) return `no data in ${hours} h`
  if (waitingHours === 0) return `none waiting in ${hours} h`
  return `waiting in ${waitingHours} of ${hours} h`
}

export type HourBucket = { hourMs: number; working: number | null }

const HOUR_MS = 3_600_000

/**
 * One bucket per hour, oldest first, ending with the hour that contains `now`. `working` is the
 * highest working count seen in that hour; an hour with no snapshot at all is `null` (a feed
 * stall), never 0.
 */
export function hourlyWorking(
  history: HistoryPoint[] | undefined,
  hours: number,
  now: number,
): HourBucket[] {
  if (hours < 1) return []
  const endHour = Math.floor(now / HOUR_MS) * HOUR_MS
  const buckets: HourBucket[] = Array.from({ length: hours }, (_, i) => ({
    hourMs: endHour - (hours - 1 - i) * HOUR_MS,
    working: null,
  }))
  for (const p of history ?? []) {
    const working = p.summary?.working
    const atMs = parseMs(p.receivedAt)
    if (!isCount(working) || atMs === null) continue
    const slot = Math.floor((Math.floor(atMs / HOUR_MS) * HOUR_MS - buckets[0]!.hourMs) / HOUR_MS)
    const bucket = buckets[slot]
    if (!bucket) continue
    bucket.working = Math.max(bucket.working ?? 0, working)
  }
  return buckets
}

/** The busiest measured hour; `null` when no hour carries a snapshot (nothing was measured, not zero). */
export function peakWorking(
  buckets: readonly HourBucket[],
): { value: number; hourMs: number } | null {
  let peak: { value: number; hourMs: number } | null = null
  for (const b of buckets) {
    if (b.working === null) continue
    if (peak === null || b.working > peak.value) peak = { value: b.working, hourMs: b.hourMs }
  }
  return peak
}

/** Completed hours with no snapshot (the in-progress hour is not a gap). */
export const gapHours = (buckets: readonly HourBucket[], now: number): number => {
  const currentHourMs = Math.floor(now / HOUR_MS) * HOUR_MS
  return buckets.filter((b) => b.working === null && b.hourMs !== currentHourMs).length
}

/** Activity-strip footer: the busiest hour and how many hours had an agent working; `null` when nothing was measured. */
export function activityFact(buckets: readonly HourBucket[]): string | null {
  const peak = peakWorking(buckets)
  if (peak === null) return null
  const active = buckets.filter((b) => (b.working ?? 0) > 0).length
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    peak.hourMs,
  )
  return peak.value === 0
    ? `no agent working in ${buckets.length} h`
    : `busiest hour ${clock} · agents working in ${active} of ${buckets.length} h`
}

// ── Projects ─────────────────────────────────────────────────────────────────────────────────

/** Worst first — the state a collapsed project row is labelled with. */
const WORST_ORDER: AgentState[] = ['needs_you', 'stale', 'unknown', 'working', 'idle', 'done']

export type ProjectGroup = {
  name: string
  agents: AgentRow[]
  counts: Record<AgentState, number>
  working: AgentRow[]
  lastActivityAt: number | null
  git: OverviewProject['git']
  sources: Record<string, number>
  worst: AgentState
  /** Title of the most recently active working/needs-you agent. */
  now: string | null
  /** A project card is warranted: at least one working or needs-you agent. */
  active: boolean
}

const emptyCounts = (): Record<AgentState, number> => ({
  needs_you: 0,
  working: 0,
  idle: 0,
  stale: 0,
  done: 0,
  unknown: 0,
})

function buildGroup(name: string, agents: AgentRow[], git: OverviewProject['git']): ProjectGroup {
  const counts = emptyCounts()
  const sources: Record<string, number> = {}
  let lastActivityAt: number | null = null
  for (const a of agents) {
    const state = Object.hasOwn(counts, a.state) ? a.state : 'unknown'
    counts[state] += 1
    const source = (a.source ?? 'unknown').split(/[\s:·]/)[0] || 'unknown'
    sources[source] = (sources[source] ?? 0) + 1
    if (a.lastActivityAt != null && (lastActivityAt === null || a.lastActivityAt > lastActivityAt))
      lastActivityAt = a.lastActivityAt
  }
  const live = agents
    .filter((a) => a.state === 'working' || a.state === 'needs_you')
    .toSorted((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
  return {
    name,
    agents,
    counts,
    working: agents.filter((a) => a.state === 'working'),
    lastActivityAt,
    git,
    sources,
    worst: WORST_ORDER.find((s) => counts[s] > 0) ?? 'unknown',
    now: live[0]?.title ?? null,
    active: live.length > 0,
  }
}

/**
 * Every project in `projects[]` plus any project that only appears on an agent row, so none is
 * dropped. Active projects (a working or needs-you agent) come first, most recent activity first;
 * the rest follow in the same order.
 */
export function groupProjects(
  snapshot: OverviewSnapshot | undefined,
  agents: AgentRow[],
): { active: ProjectGroup[]; quiet: ProjectGroup[] } {
  const byName = new Map<string, AgentRow[]>()
  const git = new Map<string, OverviewProject['git']>()
  for (const p of snapshot?.projects ?? []) {
    byName.set(p.name, [])
    git.set(p.name, p.git)
  }
  for (const a of agents) byName.set(a.project, [...(byName.get(a.project) ?? []), a])
  const groups = [...byName].map(([name, rows]) => buildGroup(name, rows, git.get(name)))
  const recent = (g: ProjectGroup) => g.lastActivityAt ?? 0
  const sorted = groups.toSorted((a, b) => recent(b) - recent(a))
  return { active: sorted.filter((g) => g.active), quiet: sorted.filter((g) => !g.active) }
}

/** How long the longest-running working agent has been up (`startedAt`, else its last activity); `null` without a clock. */
export function longestRunMs(agents: readonly AgentRow[], now: number): number | null {
  const ages = agents.flatMap((a) => {
    const since = a.startedAt ?? a.lastActivityAt
    return since == null ? [] : [Math.max(0, now - since)]
  })
  return ages.length === 0 ? null : Math.max(...ages)
}

// ── Needs-you cards ──────────────────────────────────────────────────────────────────────────

const HEADLINE_MAX = 90
/** A sentence with no clause boundary stays whole up to this (the card title wraps); past it, ellipsis. */
const HEADLINE_WRAP_MAX = 2 * HEADLINE_MAX

/** `item` / `items`, and with the count: `1 item` / `3 items`. */
export const itemNoun = (n: number): string => (n === 1 ? 'item' : 'items')
export const items = (n: number): string => `${n} ${itemNoun(n)}`

/** Where a long sentence may end without cutting a thought: before a parenthesis, colon, dash, semicolon or comma. */
const CLAUSE_END = /\s\(|: | — |; |, /g

/**
 * The headline of an ask: its first sentence. A sentence over {@link HEADLINE_MAX} ends at the last clause
 * boundary that fits (no ellipsis, the full ask is behind the disclosure); with none it stays whole
 * up to {@link HEADLINE_WRAP_MAX} (the title wraps, the question reads whole) and only then
 * ellipsizes, at a word boundary.
 */
export function headlineOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const stop = flat.search(/[.!?](\s|$)/)
  const sentence = stop === -1 ? flat : flat.slice(0, stop + 1)
  if (sentence.length <= HEADLINE_MAX) return sentence
  const floor = Math.floor(HEADLINE_MAX * 0.3)
  let clauseEnd = -1
  for (const match of sentence.matchAll(CLAUSE_END)) {
    if (match.index > HEADLINE_MAX) break
    if (match.index >= floor) clauseEnd = match.index
  }
  if (clauseEnd !== -1) return sentence.slice(0, clauseEnd).replace(/[\s,;:—-]+$/, '')
  if (sentence.length <= HEADLINE_WRAP_MAX) return sentence
  const cut = sentence.slice(0, HEADLINE_WRAP_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// ── Page summary ─────────────────────────────────────────────────────────────────────────────

export type SummaryInput = {
  items: number
  oldestWaitMs: number | null
  /** Oldest human-queue ask; named only when no agent is waiting. */
  oldestAskMs?: number | null
  /** `null` when the snapshot has no complete summary: the fleet fact is left out, not zeroed. */
  fleet: { working: number; total: number } | null
  /** Projects in the quiet bucket the Projects section lists. */
  idleProjects: number
}

/** The headline (count + oldest wait) and the facts under it (fleet, idle projects). */
export function summaryParts(s: SummaryInput): { sentence: string; facts: string[] } {
  const fleet = s.fleet === null ? null : `${s.fleet.working} of ${s.fleet.total} agents working`
  const idle = `${s.idleProjects} ${s.idleProjects === 1 ? 'project' : 'projects'} idle`
  if (s.items === 0) {
    // The fleet carries the headline's number when nothing waits.
    return fleet === null
      ? { sentence: 'Nothing needs you.', facts: [idle] }
      : { sentence: `Nothing needs you; ${fleet}.`, facts: [idle] }
  }
  const facts = [fleet, idle].filter((f): f is string => f !== null)
  const noun = s.items === 1 ? 'item needs' : 'items need'
  const wait =
    s.oldestWaitMs !== null
      ? `, oldest agent wait ${formatWaitDuration(s.oldestWaitMs)}`
      : s.oldestAskMs != null
        ? `, oldest ask ${formatWaitDuration(s.oldestAskMs)}`
        : ''
  return { sentence: `${s.items} ${noun} you${wait}.`, facts }
}

// ── Narratives ───────────────────────────────────────────────────────────────────────────────

export type NarrativeGroup<T> = { label: string; items: T[] }

const DAY_MS = 86_400_000

const localDay = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Day heading: Today / Yesterday / `Mon 12 Oct`. */
export function dayLabel(ms: number, now: number): string {
  const diff = Math.round((localDay(now) - localDay(ms)) / DAY_MS)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(ms)
    .replace(',', '')
}

/** Heading of the group for items whose timestamp cannot be read. */
const UNDATED = '—'

/** Newest first by `revisedAt`, grouped by local day; unreadable timestamps form a trailing `—` group. */
export function groupByDay<T extends { revisedAt: string }>(
  items: readonly T[],
  now: number,
): NarrativeGroup<T>[] {
  const dated = items.flatMap((item) => {
    const ms = parseMs(item.revisedAt)
    return ms === null ? [] : [{ item, ms }]
  })
  const groups: NarrativeGroup<T>[] = []
  for (const { item, ms } of dated.toSorted((a, b) => b.ms - a.ms)) {
    const label = dayLabel(ms, now)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  const undated = items.filter((item) => parseMs(item.revisedAt) === null)
  if (undated.length > 0) groups.push({ label: UNDATED, items: undated })
  return groups
}

/** `HH:MM` of an ISO timestamp, `—` when unreadable. */
export function clockTime(iso: string): string {
  const ms = parseMs(iso)
  if (ms === null) return '—'
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)
}

/** `"6m ago"`, or `"just now"` under a minute; `"—"` for a bad duration. */
export function ageAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 60_000 ? 'just now' : `${formatWaitDuration(ms)} ago`
}

// ── Needs-you cards (view models) ────────────────────────────────────────────────────────────

export type NeedsYouCard = {
  key: string
  kind: 'human-queue' | 'agent'
  /** A short question; the full ask sits behind {@link NeedsYouCard.fullAsk}. */
  headline: string
  /** `[project, 'waiting 6m', machine]`; a missing clock or host is left out. */
  facts: string[]
  /** The one evidence line: the command, or the latest blocker. */
  inset: string | null
  /** Context excerpt for the right column; `null` unless the payload carries a real one. */
  preview: string | null
  /** The one copy action, backed by a payload field. */
  copy: { label: string; value: string } | null
  /** The full ask, behind a disclosure. */
  fullAsk: { label: string; text: string } | null
  abandoned: boolean
  /** Sort key, oldest wait first. */
  waitMs: number
}

const isText = (v: string | null): v is string => v !== null && v !== ''

const QUESTION_MAX = 80
const EVIDENCE_MAX = 160
const PREVIEW_MAX = 220

const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Cuts at the last word boundary that fits, with an ellipsis. */
function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * A short question for a card title: the ask's first sentence, markdown marks removed, ended at the
 * last clause boundary that fits {@link QUESTION_MAX}, else at a word with an ellipsis. The full
 * text stays behind the card's disclosure.
 */
export function questionOf(text: string): string {
  const flat = flatten(text.replace(/[`*_#>]/g, ''))
  const stop = flat.search(/[.!?](\s|$)/)
  const sentence = stop === -1 ? flat : flat.slice(0, stop + 1)
  if (sentence.length <= QUESTION_MAX) return sentence
  let clauseEnd = -1
  for (const match of sentence.matchAll(CLAUSE_END)) {
    if (match.index > QUESTION_MAX) break
    if (match.index >= QUESTION_MAX * 0.4) clauseEnd = match.index
  }
  if (clauseEnd !== -1) return sentence.slice(0, clauseEnd).replace(/[\s,;:—-]+$/, '')
  return ellipsize(sentence, QUESTION_MAX)
}

const nonEmptyLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** The blocker the agent reports, one line; `null` when it reports none. */
export function evidenceLine(a: AgentRow): string | null {
  const text = a.blocker ?? a.waitingFor ?? a.standing
  const line = text ? nonEmptyLines(text)[0] : undefined
  return line ? ellipsize(line, EVIDENCE_MAX) : null
}

/** The agent's last reply as context: its final paragraph, kept only when it adds to the evidence line. */
export function previewOf(a: AgentRow, evidence: string | null): string | null {
  const paragraphs = (a.lastReply ?? '')
    .split(/\n\s*\n/)
    .map(flatten)
    .filter(Boolean)
  const last = paragraphs.at(-1)
  if (!last || last === evidence) return null
  return ellipsize(last, PREVIEW_MAX)
}

type QueueItem = {
  id: string
  askedAt?: string | null | undefined
  question: string
  cmd?: string | null | undefined
  [key: string]: unknown
}

export type CardContext = {
  /** Producer host of the snapshot, used when an ask carries no host of its own. */
  machine?: string | null
  /** Age of the snapshot, the evidence line's fallback. */
  snapshotAgeMs?: number | null
}

/** Human-queue asks and `needs_you` agents as one list, longest wait first. */
export function needsYouCards(
  humanQueue: readonly QueueItem[],
  agents: readonly AgentRow[],
  now: number,
  ctx: CardContext = {},
): NeedsYouCard[] {
  const machine = ctx.machine ?? null
  const asks: NeedsYouCard[] = humanQueue.map((item) => {
    const askedMs = parseMs(item.askedAt)
    const waitMs = askedMs === null ? -1 : Math.max(0, now - askedMs)
    const host = typeof item['host'] === 'string' ? item['host'] : machine
    const facts = ['human queue', host, waitMs >= 0 ? `asked ${ageAgo(waitMs)}` : null].filter(
      isText,
    )
    const headline = questionOf(item.question)
    return {
      key: `hq-${item.id}`,
      kind: 'human-queue',
      headline,
      facts,
      inset: item.cmd?.trim() || null,
      preview: null,
      copy: item.cmd?.trim() ? { label: 'Copy command', value: item.cmd.trim() } : null,
      fullAsk:
        headline === flatten(item.question)
          ? null
          : { label: `Full ask · ${item.question.length} chars`, text: item.question },
      abandoned: false,
      waitMs,
    }
  })
  const waiting: NeedsYouCard[] = agents
    .filter((a) => a.state === 'needs_you')
    .map((a) => {
      const waitMs = a.lastActivityAt == null ? -1 : Math.max(0, now - a.lastActivityAt)
      const facts = [
        a.project,
        waitMs >= 0 ? `waiting ${formatWaitDuration(waitMs)}` : null,
        machine,
      ].filter(isText)
      const title = a.title ?? a.lastPrompt ?? a.id
      const headline = questionOf(title)
      const blocker = evidenceLine(a)
      const fallback =
        ctx.snapshotAgeMs == null
          ? null
          : `no blocker reported · snapshot ${ageAgo(ctx.snapshotAgeMs)}`
      return {
        key: `agent-${a.id}`,
        kind: 'agent',
        headline,
        facts,
        inset: blocker ?? fallback,
        preview: previewOf(a, blocker),
        copy: a.paneId ? { label: 'Copy pane id', value: a.paneId } : null,
        fullAsk:
          headline === flatten(title)
            ? null
            : { label: `Full ask · ${title.length} chars`, text: title },
        abandoned: isAbandonedWait(a, now),
        waitMs,
      }
    })
  return [...asks, ...waiting].toSorted((a, b) => b.waitMs - a.waitMs)
}

/**
 * How many items the Needs-you section renders: every human-queue ask plus every `needs_you`
 * agent, i.e. `needsYouCards(...).length`. The snapshot's own `summary.needsYou` counts agents
 * only, so it reads 0 while the section lists asks.
 */
export function needsYouCount(
  humanQueue: readonly QueueItem[],
  agents: readonly AgentRow[],
  now: number,
): number {
  return needsYouCards(humanQueue, agents, now).length
}

/** Age of the oldest human-queue ask that carries a timestamp; `null` when none does. */
export function oldestAskMs(
  humanQueue: readonly { askedAt?: string | null | undefined }[],
  now: number,
): number | null {
  const ages = humanQueue.flatMap((i) => {
    const ms = parseMs(i.askedAt)
    return ms === null ? [] : [Math.max(0, now - ms)]
  })
  return ages.length === 0 ? null : Math.max(...ages)
}

// ── Feed state ───────────────────────────────────────────────────────────────────────────────

export type FeedState = 'pending' | 'failed' | 'stale' | 'ok'

/**
 * What the snapshot query says about the page: still loading with nothing to show, failed with
 * nothing to show, failed but with a previous snapshot on screen (`stale`), or fine. A fetch error
 * is Argo's, not the producer's, so it never reads as "the producer stopped pushing".
 */
export function feedState(q: {
  hasData: boolean
  isPending: boolean
  isError: boolean
}): FeedState {
  if (q.hasData) return q.isError ? 'stale' : 'ok'
  if (q.isError) return 'failed'
  return q.isPending ? 'pending' : 'ok'
}

/** The freshness word beside the headline: never `Live` for a failed or stale-served feed. */
export function feedAside(
  feed: FeedState,
  ageMs: number | null,
): { text: string; tone: 'live' | 'warn' } | null {
  if (ageMs === null || feed === 'pending' || feed === 'failed') return null
  const live = feed === 'ok' && ageMs < STALE_AFTER_MS
  return {
    text: `${live ? 'Live' : 'Stale'} · updated ${ageAgo(ageMs)}`,
    tone: live ? 'live' : 'warn',
  }
}
