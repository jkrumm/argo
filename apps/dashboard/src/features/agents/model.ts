import type {
  OverviewAgent,
  OverviewProject,
  OverviewRecord,
  OverviewSnapshot,
  OverviewSummary,
  HistoryPoint,
} from '../../lib/queries/agents'
import {
  cardCopy,
  isAlert,
  plainQuestion,
  resolveCopies,
  type CardCopy,
  type Disambiguation,
} from '../../lib/question-copy'
import {
  asText,
  authoredQuestion,
  firstSentence,
  flatten,
  restAfterFirstSentence,
} from '../../lib/text'
import { withUnit } from '../../lib/format'

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
  if (days > 0) return `${withUnit(days, 'd')} ${withUnit(hours, 'h')}`
  if (hours > 0) return `${withUnit(hours, 'h')} ${withUnit(minutes, 'm')}`
  return withUnit(minutes, 'm')
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

const HOUR_MS = 3_600_000

/** `HH:MM` of an epoch-ms time. Built per call: a formatter cached at import would freeze the zone `home`'s tests switch at runtime. */
export const clockOf = (ms: number): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// ── Fleet by state ───────────────────────────────────────────────────────────────────────────

/** Segment order of the fleet meter. `dispatch` is a source count that overlaps working/done, so it is never a part. */
const FLEET_STATES = ['working', 'needs_you', 'idle', 'stale', 'done'] as const
type SummaryState = (typeof FLEET_STATES)[number]
export type FleetState = SummaryState | 'unknown'

export type FleetPart = { key: FleetState; label: string; value: number }

/** Agents whose state is `unknown` or none of the five the summary counts. */
export const countUnknownAgents = (agents: readonly AgentRow[]): number =>
  agents.filter((a) => !(FLEET_STATES as readonly string[]).includes(a.state)).length

/** The meter legend's words: `idle` and `unknown` are named for what they say about the agent. */
const FLEET_LABEL: Record<FleetState, string> = {
  working: 'working',
  needs_you: 'needs you',
  idle: 'open, not working',
  stale: 'stale',
  done: 'done',
  unknown: 'state not reported',
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
    : `longest run ${formatWaitDuration(longestRunMs)}`
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
  const scope =
    measured.length < buckets.length
      ? `${withUnit(measured.length, 'h')} observed`
      : `${withUnit(buckets.length, 'h')}`
  if (peak.value === 0) return `no agent working in ${scope}`
  const active = measured.filter((b) => (b.working ?? 0) > 0).length
  return `busiest hour ${clockOf(peak.hourMs)} · agents working in ${active} of ${scope}`
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

/** How long the longest-running working agent has been up (`startedAt` only: last activity is not a run); `null` when none reports a start. */
export function longestRunMs(agents: readonly AgentRow[], now: number): number | null {
  const ages = agents.flatMap((a) => (a.startedAt == null ? [] : [Math.max(0, now - a.startedAt)]))
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

export type AgentsSummaryInput = {
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
 * The page's verdict. Its one figure is the one nothing else on the page prints: how many projects
 * the blocked agents sit in (the strip has the count, the oldest wait and the fleet).
 */
export function agentsSummaryParts(s: AgentsSummaryInput): { sentence: string } {
  const { agentWaits, asks, projects } = s
  if (agentWaits === 0 && asks === 0) return { sentence: 'Nothing needs you.' }
  if (agentWaits === 0)
    return { sentence: `${nounFor(asks, 'A request is', 'Requests are')} waiting for your answer.` }
  const where = `in ${projects} ${nounFor(projects, 'project', 'projects')}`
  if (asks > 0) return { sentence: `Agents ${where} and the human queue are waiting on you.` }
  return {
    sentence: `${nounFor(agentWaits, 'An agent', 'Agents')} ${where} ${nounFor(agentWaits, 'is', 'are')} waiting on you.`,
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

/** `"6m ago"`, or `"just now"` under a minute; `"—"` for a bad duration. */
export function ageAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 60_000 ? 'just now' : `${formatWaitDuration(ms)} ago`
}

// ── Needs-you cards (view models) ────────────────────────────────────────────────────────────

export type NeedsYouCard = {
  key: string
  kind: 'human-queue' | 'agent'
  /** The card title: a question, derived by the one `cardCopy` rule. */
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
  const space = cut.lastIndexOf(' ')
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

/**
 * The card copy of one human-queue ask, shared by this page and Home: the ask goes through
 * `authoredQuestion` (shortcodes stripped, blank or non-string reads as absent), its first sentence
 * is the question when it is one, the rest is evidence.
 */
export function humanQueueCopy(
  item: QueueItem,
  { handle = null }: { handle?: Disambiguation | null } = {},
): { copy: CardCopy; askText: string } {
  const askText = authoredQuestion(item.question) ?? ''
  const title = asText(item['title'])
  const host = hostOf(item)
  // An alert is asked about as an alert, never as a request to answer.
  const alert = isAlert({ kinds: [item['kind'], item['type']], title })
  const plain = alert
    ? plainQuestion('Handle', host ? `${host} alert` : 'this alert')
    : plainQuestion('Answer', host ? `${host} request` : 'this request')
  const handleSource = flatten(title) || askText
  const copy = cardCopy({
    ask: firstSentence(askText),
    body: restAfterFirstSentence(askText),
    title: title === '' ? null : title,
    plain,
    handle: handle !== null && handleSource !== '' ? { source: handleSource, ...handle } : null,
  })
  return { copy, askText }
}

/** The agent's project, `''` when it names none (`—` is the flattening's placeholder). */
const projectOf = (a: AgentRow): string => {
  const project = asText(a.project)
  return project === '—' ? '' : project
}

/** The agent's task as a title: its title, else its last prompt, else its id. */
const titleOf = (a: AgentRow): string =>
  [a.title, a.lastPrompt, a.id].map(asText).find((t) => t.trim() !== '') ?? ''

/** What a card says when the agent reported no blocker: the absence is the fact. */
export const NO_BLOCKER = 'No blocker reported.'

/** The agent's blocker as evidence, or {@link NO_BLOCKER}: one rule for this page and Home. */
export const blockerEvidence = (a: AgentRow): string => evidenceSource(a) ?? NO_BLOCKER

/** The card copy of one `needs_you` agent, shared by this page and Home; `body` is its evidence. */
export function agentCopy(
  a: AgentRow,
  body: string | null,
  { handle = null }: { handle?: Disambiguation | null } = {},
): CardCopy {
  const title = titleOf(a)
  const project = projectOf(a)
  return cardCopy({
    authored: authoredQuestion(a['question']),
    body,
    title,
    plain: plainQuestion('Unblock', project === '' ? 'this agent' : `${project} agent`),
    handle: handle !== null && title !== '' ? { source: title, ...handle } : null,
    keepQuestionEvidence: true,
  })
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
  // One surface: two cards that would read the same are told apart by their own handle.
  const copies = resolveCopies(
    [
      ...humanQueue.map((ask) => ({ key: `hq-${asText(ask.id)}`, ask })),
      ...needing.map((agent) => ({ key: `agent-${asText(agent.id)}`, agent })),
    ],
    {
      key: (entry) => entry.key,
      derive: (entry, options) => ({
        copy:
          'agent' in entry
            ? agentCopy(entry.agent, blockerEvidence(entry.agent), options)
            : humanQueueCopy(entry.ask, options).copy,
      }),
    },
  ).map((r) => r.copy)
  const asks: NeedsYouCard[] = humanQueue.map((item, i) => {
    const askedMs = parseMs(item.askedAt)
    const waitMs = askedMs === null ? -1 : Math.max(0, now - askedMs)
    const host = hostOf(item)
    const facts = ['human queue', host, waitMs >= 0 ? `asked ${ageAgo(waitMs)}` : null].filter(
      isText,
    )
    const command = asText(item.cmd).trim() || null
    const copy = copies[i]!
    const { askText } = humanQueueCopy(item)
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
    const waitMs = a.lastActivityAt == null ? -1 : Math.max(0, now - a.lastActivityAt)
    const facts = [
      projectOf(a),
      waitMs >= 0 ? `waiting ${formatWaitDuration(waitMs)}` : null,
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
    text: `${live ? 'Live' : 'Stale'} · updated ${ageAgo(ageMs)}`,
    tone: live ? 'live' : 'warn',
  }
}
