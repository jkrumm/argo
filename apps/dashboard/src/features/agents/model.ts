import type { BadgeProps } from '@mantine/core'
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

export const STATE_COLOR: Record<AgentState, NonNullable<BadgeProps['color']>> = {
  needs_you: 'red',
  working: 'blue',
  idle: 'gray',
  stale: 'orange',
  done: 'green',
  unknown: 'gray',
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

/** One count's trend over the history window. A point without a summary is omitted, not plotted as 0. */
export function trendSeries(
  history: HistoryPoint[] | undefined,
  key: 'needsYou' | 'working',
): number[] {
  return (history ?? []).flatMap((p) => (p.summary ? [p.summary[key] ?? 0] : []))
}

// ── Fleet by state ───────────────────────────────────────────────────────────────────────────

/** Segment order of the fleet meter. `dispatch` is a source count that overlaps working/done, so it is never a part. */
export const FLEET_STATES = ['working', 'needs_you', 'idle', 'stale', 'done'] as const
export type FleetState = (typeof FLEET_STATES)[number]

export type FleetPart = { key: FleetState; label: string; value: number }

/** The five parts of the fleet in fixed order; `total` is their sum, so captions always add up. */
export function fleetParts(summary: OverviewSummary | undefined): {
  parts: FleetPart[]
  total: number
} {
  const parts = FLEET_STATES.map((key) => ({
    key,
    label: STATE_LABEL[key].toLowerCase(),
    value: Math.max(0, summary?.[key === 'needs_you' ? 'needsYou' : key] ?? 0),
  }))
  return { parts, total: parts.reduce((sum, p) => sum + p.value, 0) }
}

// ── Needs-you trend ──────────────────────────────────────────────────────────────────────────

export type Peak = { value: number; atMs: number }

/** The highest `needsYou` in the window and, among ties, the latest time it was seen. `null` when no point carries a summary. */
export function peakNeedsYou(history: HistoryPoint[] | undefined): Peak | null {
  let peak: Peak | null = null
  for (const p of history ?? []) {
    if (!p.summary) continue
    const value = p.summary.needsYou ?? 0
    const atMs = Date.parse(p.receivedAt)
    if (peak === null || value >= peak.value) peak = { value, atMs }
  }
  return peak
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
  const endHour = Math.floor(now / HOUR_MS) * HOUR_MS
  const buckets: HourBucket[] = Array.from({ length: hours }, (_, i) => ({
    hourMs: endHour - (hours - 1 - i) * HOUR_MS,
    working: null,
  }))
  for (const p of history ?? []) {
    if (!p.summary) continue
    const slot = Math.floor(
      (Math.floor(Date.parse(p.receivedAt) / HOUR_MS) * HOUR_MS - buckets[0]!.hourMs) / HOUR_MS,
    )
    const bucket = buckets[slot]
    if (!bucket) continue
    bucket.working = Math.max(bucket.working ?? 0, p.summary.working ?? 0)
  }
  return buckets
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
    counts[a.state] += 1
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

// ── Needs-you cards ──────────────────────────────────────────────────────────────────────────

export const HEADLINE_MAX = 90

/** First sentence of an ask, hard-capped at `max` characters with an ellipsis. */
export function headlineOf(text: string, max = HEADLINE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const stop = flat.search(/[.!?](\s|$)/)
  const sentence = stop === -1 ? flat : flat.slice(0, stop + 1)
  if (sentence.length <= max) return sentence
  const cut = sentence.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

// ── Page summary ─────────────────────────────────────────────────────────────────────────────

export type SummaryInput = {
  items: number
  oldestWaitMs: number | null
  /** Oldest human-queue ask; named only when no agent is waiting. */
  oldestAskMs?: number | null
  working: number
  total: number
  idleProjects: number
}

export function summarySentence(s: SummaryInput): string {
  const fleet = `${s.working} of ${s.total} agents working`
  if (s.items === 0) return `Nothing needs you. ${fleet}.`
  const noun = s.items === 1 ? 'item needs' : 'items need'
  const wait =
    s.oldestWaitMs !== null
      ? `, oldest agent wait ${formatWaitDuration(s.oldestWaitMs)}`
      : s.oldestAskMs != null
        ? `, oldest ask ${formatWaitDuration(s.oldestAskMs)}`
        : ''
  return `${s.items} ${noun} you${wait}. ${fleet}, ${s.idleProjects} ${s.idleProjects === 1 ? 'project' : 'projects'} idle.`
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

/** Newest first by `revisedAt`, grouped by local day. */
export function groupByDay<T extends { revisedAt: string }>(
  items: readonly T[],
  now: number,
): NarrativeGroup<T>[] {
  const groups: NarrativeGroup<T>[] = []
  for (const item of items.toSorted((a, b) => Date.parse(b.revisedAt) - Date.parse(a.revisedAt))) {
    const label = dayLabel(Date.parse(item.revisedAt), now)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

export const clockTime = (iso: string): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(Date.parse(iso))

/** `"6m ago"`, or `"just now"` under a minute; `"—"` for a bad duration. */
export function ageAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 60_000 ? 'just now' : `${formatWaitDuration(ms)} ago`
}

// ── Needs-you cards (view models) ────────────────────────────────────────────────────────────

export type NeedsYouCard = {
  key: string
  kind: 'human-queue' | 'agent'
  headline: string
  /** `<host> · asked 6m ago` / `<project> · waiting 6m`, parts already joined. */
  facts: string
  /** Mono inset body: the command, or the blocker. */
  inset: string | null
  /** The one copy action, backed by a payload field. */
  copy: { label: string; value: string } | null
  /** The full ask, behind a disclosure. */
  fullAsk: { label: string; text: string } | null
  abandoned: boolean
  /** Sort key, oldest wait first. */
  waitMs: number
}

type QueueItem = {
  id: string
  askedAt?: string | null | undefined
  question: string
  cmd?: string | null | undefined
  [key: string]: unknown
}

/** Human-queue asks and `needs_you` agents as one list, longest wait first. */
export function needsYouCards(
  humanQueue: readonly QueueItem[],
  agents: readonly AgentRow[],
  now: number,
): NeedsYouCard[] {
  const asks: NeedsYouCard[] = humanQueue.map((item) => {
    const waitMs = item.askedAt ? Math.max(0, now - Date.parse(item.askedAt)) : -1
    const host = typeof item['host'] === 'string' ? item['host'] : null
    const facts = [host, waitMs >= 0 ? `asked ${ageAgo(waitMs)}` : null].filter(Boolean).join(' · ')
    const headline = headlineOf(item.question)
    const long = headline !== item.question.replace(/\s+/g, ' ').trim()
    return {
      key: `hq-${item.id}`,
      kind: 'human-queue',
      headline,
      facts,
      inset: item.cmd?.trim() || null,
      copy: item.cmd?.trim() ? { label: 'Copy command', value: item.cmd.trim() } : null,
      fullAsk: long
        ? { label: `Full ask · ${item.question.length} chars`, text: item.question }
        : null,
      abandoned: false,
      waitMs,
    }
  })
  const waiting: NeedsYouCard[] = agents
    .filter((a) => a.state === 'needs_you')
    .map((a) => {
      const waitMs = a.lastActivityAt == null ? -1 : Math.max(0, now - a.lastActivityAt)
      const facts = [a.project, waitMs >= 0 ? `waiting ${formatWaitDuration(waitMs)}` : null]
        .filter(Boolean)
        .join(' · ')
      return {
        key: `agent-${a.id}`,
        kind: 'agent',
        headline: headlineOf(a.title ?? a.lastPrompt ?? a.id),
        facts,
        inset: a.blocker ?? a.waitingFor ?? a.standing ?? null,
        copy: a.paneId ? { label: 'Copy pane id', value: a.paneId } : null,
        fullAsk: null,
        abandoned: isAbandonedWait(a, now),
        waitMs,
      }
    })
  return [...asks, ...waiting].toSorted((a, b) => b.waitMs - a.waitMs)
}

/** Age of the oldest human-queue ask that carries a timestamp; `null` when none does. */
export function oldestAskMs(
  humanQueue: readonly { askedAt?: string | null | undefined }[],
  now: number,
): number | null {
  const ages = humanQueue.flatMap((i) =>
    i.askedAt ? [Math.max(0, now - Date.parse(i.askedAt))] : [],
  )
  return ages.length === 0 ? null : Math.max(...ages)
}
