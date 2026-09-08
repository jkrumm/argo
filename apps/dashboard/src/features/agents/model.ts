import type { BadgeProps } from '@mantine/core'
import type {
  OverviewAgent,
  OverviewRecord,
  OverviewSnapshot,
  OverviewSummary,
} from '../../lib/queries/agents'

// Presentation vocabulary for the agents page. The STATE and RECOMMENDATION
// enums are sideclaw's (server/lib/agents.ts); Argo only maps them to a label,
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

export const RECOMMENDATION_ICON: Record<string, string> = {
  answer: '?!',
  continue: '→',
  ship: '⇧',
  review: '⚑',
  merge: '⇄',
  close: '✓',
  stale: '·',
  watch: '●',
}

/** A snapshot older than this is a feed that stopped, not a quiet machine. */
export const STALE_AFTER_MS = 30 * 60 * 1000

export type AgentRow = OverviewAgent & { project: string }

/**
 * One flat row per agent. A producer may send a flattened `agents[]` (each
 * carrying `project`); otherwise the rows come from `projects[].agents[]`,
 * already sorted most-urgent-first by sideclaw.
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

// Mobile card list — the phone replacement for `AgentsTable`'s 6-column table
// (see agents-table.tsx for why the table itself cannot flex below `sm`).

/** Card-list sort priority: `needs_you` first, then `working`, everything else after — on a phone
 * the top of the list is all that's visible, so the two actionable states must lead. Equal
 * priorities keep their original (sideclaw's own most-urgent-first) order — `Array.prototype.sort`
 * is stable. */
const CARD_SORT_PRIORITY: Record<AgentState, number> = {
  needs_you: 0,
  working: 1,
  idle: 2,
  stale: 2,
  done: 2,
  unknown: 2,
}

export function sortAgentsForCards(agents: AgentRow[]): AgentRow[] {
  return agents.toSorted((a, b) => CARD_SORT_PRIORITY[a.state] - CARD_SORT_PRIORITY[b.state])
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

// The low-priority state counts the deleted hero tiles used to draw as boxes — kept reachable as
// one plain-text line (the table/list subtitle) rather than three near-constant tiles.

const BREAKDOWN_KEYS = ['idle', 'done', 'stale'] as const

/** `"3 idle · 4 done · 2 stale"`, omitting any bucket that is zero. Empty string when the summary
 * itself is absent or every bucket is zero. */
export function breakdownLine(summary: OverviewSummary | undefined): string {
  if (!summary) return ''
  return BREAKDOWN_KEYS.map((key) => ({ key, value: summary[key] }))
    .filter(({ value }) => typeof value === 'number' && value > 0)
    .map(({ key, value }) => `${value} ${key}`)
    .join(' · ')
}
