import type {
  OverviewAgent,
  OverviewProject,
  OverviewRecord,
  OverviewSnapshot,
  OverviewSummary,
  HistoryPoint,
} from '../../lib/queries/agents'
import {
  isAlert,
  questionForms,
  subjectOf,
  surfaceCopies,
  type CardInput,
} from '../../lib/question-copy'
import {
  asText,
  authoredQuestion,
  lastWhitespace,
  firstSentence,
  flatten,
  restAfterFirstSentence,
} from '../../lib/text'
import { NBSP, formatAgo, formatDuration, withUnit } from '../../lib/format'

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
 * The no-snapshot gap's leading clause, verbatim: the short form on every cell, and the lead of
 * {@link noSnapshotText} (the alert and the Home agents cell carry the cause and the step).
 */
export const NO_SNAPSHOT_SHORT = 'No snapshot yet'

/**
 * The strip caption with no hour measured. Never having had a snapshot is the alert's gap, so it
 * takes the alert's short form; snapshots that all predate the window are a different gap.
 */
export const noSnapshotCaption = (hasSnapshot: boolean, hours: number): string =>
  hasSnapshot ? `No snapshot in the last ${withUnit(hours, 'h')}` : NO_SNAPSHOT_SHORT

/** The overview push cadence (agent-workflows' `agw` overview workflow), minutes: every "nothing pushed yet" line names it. */
const OVERVIEW_PUSH_MIN = 10

/** The one wording for "no overview snapshot has arrived": the gap and the cadence to wait for. */
export const noSnapshotText = (): string =>
  `${NO_SNAPSHOT_SHORT} — agent-workflows pushes every ${withUnit(OVERVIEW_PUSH_MIN, 'min')}`

export type OldestWait = { ms: number; project: string }

/**
 * The longest any `needs_you` agent has been waiting, anchored on its own `lastActivityAt` — the
 * same clock `NeedsYouSection` and the table's "Last activity" column already read. `null` when no
 * `needs_you` agent carries a timestamp, so the "Oldest wait" tile can render "—" instead of a
 * false zero.
 */
export function oldestNeedsYouWait(
  agents: readonly AgentRow[],
  now = Date.now(),
): OldestWait | null {
  let oldest: OldestWait | null = null
  for (const agent of agents) {
    const activeAt = clockMs(agent.lastActivityAt)
    if (agent.state !== 'needs_you' || activeAt === null) continue
    const ms = Math.max(0, now - activeAt)
    if (oldest === null || ms > oldest.ms) oldest = { ms, project: agent.project }
  }
  return oldest
}

/** Whether a `needs_you` agent has waited past {@link ABANDONED_AFTER_MS} — the predicate
 * `NeedsYouSection` uses to split the abandoned items out from the live ones. */
export function isAbandonedWait(agent: AgentRow, now = Date.now()): boolean {
  const activeAt = clockMs(agent.lastActivityAt)
  if (agent.state !== 'needs_you' || activeAt === null) return false
  return now - activeAt > ABANDONED_AFTER_MS
}

/** An epoch-ms clock off the wire: only a finite number counts (not `'yesterday'`, not `NaN`). */
export const clockMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Epoch ms of an ISO timestamp, `null` when absent, not a string or unparseable. */
const parseMs = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || iso === '') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

const HOUR_MS = 3_600_000

/** `HH:MM` of an epoch-ms time. Built per call: a formatter cached at import would freeze the zone `home`'s tests switch at runtime. */
export const clockOf = (ms: number): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// ── Fleet by state ───────────────────────────────────────────────────────────────────────────

/** Segment order of the fleet meter. */
const FLEET_STATES = ['working', 'needs_you', 'idle', 'stale', 'done'] as const
type SummaryState = (typeof FLEET_STATES)[number]
export type FleetState = SummaryState | 'unknown'

export type FleetPart = { key: FleetState; label: string; value: number }

/** Agents whose state is `unknown` or none of the five the summary counts. */
export const countUnknownAgents = (agents: readonly AgentRow[]): number =>
  agents.filter((a) => !(FLEET_STATES as readonly string[]).includes(a.state)).length

/** The meter legend's words: one name per state, the same one the project chips print. */
const FLEET_LABEL: Record<FleetState, string> = {
  working: 'working',
  needs_you: 'needs you',
  idle: 'idle',
  stale: 'stale',
  done: 'done',
  unknown: 'unknown',
}

const summaryKey = (key: SummaryState) => (key === 'needs_you' ? 'needsYou' : key)

/**
 * The fleet in fixed order, `total` their sum so captions always add up. `unknownAgents` (agents
 * whose state is none of the five) rides as a sixth part only when present, so the total matches
 * the agent roster. `null` when the snapshot carries no summary or only part of it: an unreported
 * count is unknown, never an observed zero.
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
    label: FLEET_LABEL[key],
    value: Math.max(0, counts[i] ?? 0),
  }))
  if (unknownAgents > 0)
    parts.push({ key: 'unknown', label: FLEET_LABEL.unknown, value: unknownAgents })
  return { parts, total: parts.reduce((sum, p) => sum + p.value, 0) }
}

/**
 * The one fleet fact the meter does not show: how long the longest-running working agent has been
 * up. With agents working but none reporting a start time it says so rather than guess.
 */
export const fleetFact = (longestRunMs: number | null, working: number): string => {
  if (working === 0) return 'no agent working'
  return longestRunMs === null
    ? 'longest run not reported'
    : `longest run ${formatDuration(longestRunMs)}`
}

// ── Activity window ──────────────────────────────────────────────────────────────────────────

export type HourBucket = { hourMs: number; working: number | null }

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

/** The busiest observed hour; `null` when no hour carries a snapshot (nothing was observed, not zero). */
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

/**
 * Activity-strip footer: the busiest hour and how many observed hours had an agent working. Hours
 * without a snapshot are left out of the denominator and named when present.
 */
export function activityFact(
  buckets: readonly HourBucket[],
  peak: { value: number; hourMs: number } | null,
): string | null {
  if (peak === null) return null
  const measured = buckets.filter((b) => b.working !== null)
  const partial = measured.length < buckets.length
  const span = withUnit(partial ? measured.length : buckets.length, 'h')
  const observed = partial ? ' observed' : ''
  if (peak.value === 0) return `no agent working in ${span}${observed}`
  const active = measured.filter((b) => (b.working ?? 0) > 0).length
  // `{n} of {m} h` is one figure: it wraps whole, so the unit never sits on a line alone.
  return `busiest hour ${clockOf(peak.hourMs)} · agents working in ${active}${NBSP}of${NBSP}${span}${observed}`
}

// ── Activity legend ──────────────────────────────────────────────────────────────────────────

export const agentCount = (n: number) => `${n} ${n === 1 ? 'agent' : 'agents'}`

/** The state an hour with `working` agents (> 0) belongs to: the peak, or the lighter range below it. */
export const bandStateOf = (working: number, peak: number): 'peak' | 'working' =>
  working === peak ? 'peak' : 'working'

/** The lighter range's label: `1 agent` when the peak is 2 (the range collapses to one), else `1–{peak-1}`. */
const workingRangeLabel = (peak: number): string =>
  peak === 2 ? `${agentCount(1)} working` : `1–${agentCount(peak - 1)} working`

/**
 * The working entries of the activity key, each with a representative `sample` count for its swatch. None at a peak of 0 (no cell carries the colour); only
 * the peak at 1 (no range below it); both above.
 */
export function activityLegend(
  peak: number,
): { key: 'working' | 'peak'; label: string; sample: number }[] {
  if (peak < 1) return []
  const peakEntry = { key: 'peak' as const, label: `${agentCount(peak)} working`, sample: peak }
  return peak === 1
    ? [peakEntry]
    : [{ key: 'working', label: workingRangeLabel(peak), sample: 1 }, peakEntry]
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
    const activeAt = clockMs(a.lastActivityAt)
    if (activeAt !== null && (lastActivityAt === null || activeAt > lastActivityAt))
      lastActivityAt = activeAt
  }
  const live = agents
    .filter((a) => a.state === 'working' || a.state === 'needs_you')
    .toSorted((a, b) => (clockMs(b.lastActivityAt) ?? 0) - (clockMs(a.lastActivityAt) ?? 0))
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

/** How long the longest-running working agent has been up (`startedAt` only: last activity is not a run); `null` when none reports a start. */
export function longestRunMs(agents: readonly AgentRow[], now: number): number | null {
  const ages = agents.flatMap((a) => (a.startedAt == null ? [] : [Math.max(0, now - a.startedAt)]))
  return ages.length === 0 ? null : Math.max(...ages)
}

// ── Needs-you cards ──────────────────────────────────────────────────────────────────────────

const HEADLINE_MAX = 90
/** A sentence with no clause boundary stays whole up to this (the card title wraps); past it, ellipsis. */
const HEADLINE_WRAP_MAX = 2 * HEADLINE_MAX

/** `item` / `items`. */
export const itemNoun = (n: number): string => (n === 1 ? 'item' : 'items')

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
  const space = lastWhitespace(cut)
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// ── Page summary ─────────────────────────────────────────────────────────────────────────────

export type AgentsSummaryInput = {
  /** Of the waiting agents, how many are past the abandoned mark: a figure the strip does not print. */
  abandoned?: number
  /** Distinct hosts the human-queue asks came from. */
  hosts?: number
  /** The longest any waiting item has waited; `null` when no clock is reported. */
  oldestWaitMs?: number | null
  /** Agents in `needs_you`, counted from the cards the section lists. */
  agentWaits: number
  /** Asks in the human queue, counted from the same cards. */
  asks: number
  /** Distinct projects those waiting agents belong to. */
  projects: number
}

const nounFor = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** Distinct projects with an agent waiting on the owner. */
export const waitingProjects = (agents: readonly AgentRow[]): number =>
  new Set(
    agents
      .filter((a) => a.state === 'needs_you')
      .map(projectOf)
      .filter((p) => p !== ''),
  ).size

/**
 * The page's verdict. Its figures are the ones the strip does not print beside the sentence: how many
 * projects the blocked agents sit in, how many of them are abandoned, how many hosts the asks came
 * from, and the oldest wait (the strip's count and fleet stay in the strip).
 */
export function agentsSummaryParts(s: AgentsSummaryInput): { sentence: string } {
  const { agentWaits, asks, projects, oldestWaitMs = null, abandoned = 0, hosts = 0 } = s
  const oldest = oldestWaitMs === null ? '' : ` Oldest wait ${formatDuration(oldestWaitMs)}.`
  if (agentWaits === 0 && asks === 0) return { sentence: 'Nothing needs you.' }
  if (agentWaits === 0) {
    const from = hosts === 0 ? '' : ` from ${hosts} ${nounFor(hosts, 'host', 'hosts')}`
    return {
      sentence: `${nounFor(asks, 'A request', 'Requests')}${from} ${nounFor(asks, 'is', 'are')} waiting for your answer.${oldest}`,
    }
  }
  // With no named project there is no figure to give: the sentence says only who waits.
  const where = projects === 0 ? '' : ` in ${projects} ${nounFor(projects, 'project', 'projects')}`
  const abandonedClause =
    abandoned === 0
      ? ''
      : abandoned === agentWaits
        ? ', all abandoned'
        : `, ${abandoned} of them abandoned`
  if (asks > 0)
    return {
      sentence: `Agents${where} and the human queue are waiting on you${abandonedClause}.${oldest}`,
    }
  return {
    sentence: `${nounFor(agentWaits, 'An agent', 'Agents')}${where} ${nounFor(agentWaits, 'is', 'are')} waiting on you${abandonedClause}.${oldest}`,
  }
}

/** The needs-you tile's footer: the split of its count into the two kinds, when there are two. */
export function needsYouSplit(agentWaits: number, asks: number): string {
  // One kind alone is the tile's own count.
  if (agentWaits === 0 || asks === 0) return ''
  return [
    agentWaits > 0 ? `${agentWaits} ${nounFor(agentWaits, 'agent', 'agents')}` : null,
    asks > 0 ? `${asks} ${nounFor(asks, 'ask', 'asks')}` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')
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
  return ms === null ? '—' : clockOf(ms)
}

// ── Needs-you cards (view models) ────────────────────────────────────────────────────────────

export type NeedsYouCard = {
  key: string
  kind: 'human-queue' | 'agent'
  /** The card title: a question, derived by the one `questionTitles` rule. */
  question: string
  /** The raw title the question does not already say; whole. */
  entity: string | null
  /** `[project, 'waiting 6 m', machine]`; a missing clock or host is left out. */
  facts: string[]
  /** One line of evidence: the latest blocker, or why there is none. */
  evidenceLine: string | null
  /** Context excerpt for the right column; `null` unless the payload carries a real one. */
  preview: string | null
  /** Up to two copy actions, backed by payload fields: the first is the primary. Never empty. */
  actions: { label: string; value: string }[]
  /** Behind the disclosure: the whole ask or reason, and the command a human-queue ask carries. */
  disclosure: { label: string; text: string | null; command: string | null } | null
  abandoned: boolean
  /** Sort key, oldest wait first. */
  waitMs: number
}

const isText = (v: string | null): v is string => v !== null && v !== ''

const PREVIEW_MAX = 220
/** An ellipsis cut falls back to a hard cut unless a word boundary sits past this share of the limit. */
const WORD_CUT_FLOOR = 0.5

/** Cuts at the last word boundary that fits, with an ellipsis. */
function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = lastWhitespace(cut)
  return `${(space > max * WORD_CUT_FLOOR ? cut.slice(0, space) : cut).trimEnd()}…`
}

const nonEmptyLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** The blocker text the agent reports, as sent: the first of blocker, waiting-for and standing that has content. */
export const evidenceSource = (a: AgentRow): string | null =>
  [a.blocker, a.waitingFor, a.standing].find(
    (t): t is string => typeof t === 'string' && nonEmptyLines(t).length > 0,
  ) ?? null

/** The agent's last reply as context: its final paragraph, kept only when it adds to the evidence line. */
export function previewOf(a: AgentRow): string | null {
  const last = asText(a.lastReply)
    .split(/\n\s*\n/)
    .map(flatten)
    .filter(Boolean)
    .at(-1)
  if (!last) return null
  const source = evidenceSource(a)
  const shown = source ? [flatten(source), flatten(nonEmptyLines(source)[0] ?? '')] : []
  return shown.includes(last) ? null : ellipsize(last, PREVIEW_MAX)
}

type QueueItem = {
  id: string
  askedAt?: string | null | undefined
  question: string
  cmd?: string | null | undefined
  [key: string]: unknown
}

export type CardContext = {
  /** Producer host of the snapshot; named on agent cards only. An ask shows a host only when it carries one. */
  machine?: string | null
}

/** The producer host of a queue ask, when it carries one. */
const hostOf = (item: QueueItem): string | null =>
  typeof item['host'] === 'string' ? item['host'] : null

/** Distinct hosts the asks came from; an ask without a host names none. */
export const askHosts = (humanQueue: readonly QueueItem[]): number =>
  new Set(humanQueue.map(hostOf).filter((host): host is string => host !== null && host !== ''))
    .size

/**
 * The oldest wait across the `needs_you` agents and the human queue: the larger of the oldest agent
 * wait (named by its project) and the oldest ask (`the human queue`); an exact tie names the agent.
 * `null` when nothing waits or no clock is reported. The headline and the strip's cell both read
 * this, so they cannot disagree.
 */
export function oldestWait(
  humanQueue: readonly QueueItem[],
  agents: readonly AgentRow[],
  now: number,
): OldestWait | null {
  const agent = oldestNeedsYouWait(agents, now)
  const ask = oldestAskMs(humanQueue, now)
  if (ask !== null && (agent === null || ask > agent.ms))
    return { ms: ask, project: 'the human queue' }
  return agent
}

/** The oldest-wait cell's footer (a snapshot exists): the project the wait is in. */
export const oldestWaitFooter = (oldest: OldestWait | null): string | undefined =>
  oldest === null ? undefined : `in ${oldest.project}`

/** What the oldest-wait meter says when it has no wait to plot: none, or waiting without a clock. */
export function oldestWaitEmptyText(needsYou: number): string {
  return needsYou === 0 ? 'No agent or ask is waiting' : 'Waiting, but no wait time reported'
}

/** Agent waits past the abandoned mark, counted from the cards the section lists. */
export const abandonedWaits = (cards: readonly NeedsYouCard[]): number =>
  cards.filter((card) => card.kind === 'agent' && card.abandoned).length

/** Which surface a card is asked on: this page, or Home (whose only button opens this page). */
export type AgentSurface = 'agents' | 'home'

/**
 * The card input of one human-queue ask, shared by this page and Home: the ask goes through
 * `authoredQuestion` (shortcodes stripped, blank or non-string reads as absent), its first sentence
 * is the question when it is one, else the subject (`Copy ask: {subject}?`, the verb of the primary button) with the title preferred;
 * the rest is evidence.
 */
export function humanQueueInput(
  item: QueueItem,
  surface: AgentSurface = 'agents',
): { input: CardInput; askText: string } {
  const askText = authoredQuestion(item.question) ?? ''
  const title = asText(item['title'])
  const host = hostOf(item)
  // An alert is asked about as an alert, never as a request to answer.
  const alert = isAlert({ kinds: [item['kind'], item['type']], title })
  const noun = alert ? 'alert' : 'request'
  // The verb is the primary button's: a human-queue card only copies (`Copy command` when the ask
  // carries one, else `Copy ask`), so it never asks to `Answer` or `Handle` what it cannot do; an
  // alert keeps its kind (`Copy ask on alert: …`).
  const copy = asText(item.cmd).trim() ? 'Copy command' : 'Copy ask'
  const forms =
    surface === 'home'
      ? questionForms('Decide on', noun, host)
      : {
          ...questionForms(`${copy} for`, noun, host),
          stem: alert ? `${copy} on alert` : copy,
          terse: copy,
        }
  const ask = firstSentence(askText)
  return {
    input: {
      key: `hq-${asText(item.id)}`,
      ask,
      body: restAfterFirstSentence(askText),
      title: title === '' ? null : title,
      subject: subjectOf(title) ?? subjectOf(ask),
      forms,
    },
    askText,
  }
}

/** The agent's project, `''` when it names none (`—` is the flattening's placeholder). */
const projectOf = (a: AgentRow): string => {
  const project = asText(a.project).trim()
  return project === '—' ? '' : project
}

/** The agent's task as a title: its title, else its last prompt, else its id. */
const titleOf = (a: AgentRow): string =>
  [a.title, a.lastPrompt, a.id].map(asText).find((t) => t.trim() !== '') ?? ''

/** What a card says when the agent reported no blocker: the absence is the fact. */
const NO_BLOCKER = 'No blocker reported.'

/** The agent's blocker as evidence, or {@link NO_BLOCKER}: one rule for this page and Home. */
export const blockerEvidence = (a: AgentRow): string => evidenceSource(a) ?? NO_BLOCKER

/** The card input of one `needs_you` agent, shared by this page and Home; `body` is its evidence. */
export function agentInput(
  a: AgentRow,
  body: string | null,
  surface: AgentSurface = 'agents',
): CardInput {
  const project = projectOf(a)
  return {
    key: `agent-${asText(a.id)}`,
    authored: authoredQuestion(a['question']),
    body,
    title: titleOf(a),
    // The id names the agent, not its task: it is no subject.
    subject: subjectOf([a.title, a.lastPrompt].map(asText).find((t) => t.trim() !== '')),
    forms:
      surface === 'home'
        ? questionForms('Decide on', 'agent', project)
        : questionForms('Unblock', 'agent', project),
    keepQuestionEvidence: true,
  }
}

/** Human-queue asks and `needs_you` agents as one list, longest wait first. */
export function needsYouCards(
  humanQueue: readonly QueueItem[],
  agents: readonly AgentRow[],
  now: number,
  ctx: CardContext = {},
): NeedsYouCard[] {
  const machine = ctx.machine ?? null
  const needing = agents.filter((a) => a.state === 'needs_you')
  // One surface: two cards that would read the same are told apart together.
  const askInputs = humanQueue.map((ask) => humanQueueInput(ask))
  const copies = surfaceCopies([
    ...askInputs.map(({ input }) => input),
    ...needing.map((agent) => agentInput(agent, blockerEvidence(agent))),
  ])
  const asks: NeedsYouCard[] = humanQueue.map((item, i) => {
    const askedMs = parseMs(item.askedAt)
    const waitMs = askedMs === null ? -1 : Math.max(0, now - askedMs)
    const host = hostOf(item)
    const facts = ['human queue', host, waitMs >= 0 ? `asked ${formatAgo(waitMs)}` : null].filter(
      isText,
    )
    const command = asText(item.cmd).trim() || null
    const copy = copies[i]!
    const { askText } = askInputs[i]!
    return {
      key: `hq-${item.id}`,
      kind: 'human-queue',
      question: copy.question,
      entity: copy.entity,
      facts,
      evidenceLine: copy.evidenceLine,
      preview: null,
      actions: copyActions([
        command ? { label: 'Copy command', value: command } : null,
        { label: 'Copy ask', value: askText || copy.question },
      ]),
      disclosure: disclosureOf('ask', copy.detail, command),
      abandoned: false,
      waitMs,
    }
  })
  const waiting: NeedsYouCard[] = needing.map((a, j) => {
    const activeAt = clockMs(a.lastActivityAt)
    const waitMs = activeAt === null ? -1 : Math.max(0, now - activeAt)
    const facts = [
      projectOf(a),
      waitMs >= 0 ? `waiting${NBSP}${formatDuration(waitMs)}` : null,
      machine,
    ].filter(isText)
    const title = titleOf(a)
    const source = evidenceSource(a)
    const copy = copies[humanQueue.length + j]!
    return {
      key: `agent-${a.id}`,
      kind: 'agent',
      question: copy.question,
      entity: copy.entity,
      facts,
      evidenceLine: copy.evidenceLine,
      preview: previewOf(a),
      actions: copyActions([
        a.paneId ? { label: 'Copy pane id', value: a.paneId } : null,
        source ? { label: 'Copy blocker', value: flatten(source) } : null,
        { label: 'Copy task', value: flatten(title) || copy.question },
      ]),
      disclosure: disclosureOf('reason', copy.detail, null),
      abandoned: isAbandonedWait(a, now),
      waitMs,
    }
  })
  return [...asks, ...waiting].toSorted((a, b) => b.waitMs - a.waitMs)
}

type CopyAction = { label: string; value: string }

/** The first two copy actions that exist: a primary and, where a second exists, a secondary. */
const copyActions = (candidates: readonly (CopyAction | null)[]): CopyAction[] =>
  candidates.filter((c): c is CopyAction => c !== null && c.value.trim() !== '').slice(0, 2)

/** The disclosure of a card: the whole text when the line shortened it, and the command the ask carries. */
function disclosureOf(
  noun: 'ask' | 'reason',
  text: string | null,
  command: string | null,
): NeedsYouCard['disclosure'] {
  if (text === null && command === null) return null
  const label =
    command !== null && text !== null
      ? `Command and full ${noun}`
      : command !== null
        ? 'Command'
        : `Full ${noun}`
  return { label, text, command }
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
    text: `${live ? 'Live' : 'Stale'} · updated ${formatAgo(ageMs)}`,
    tone: live ? 'live' : 'warn',
  }
}
