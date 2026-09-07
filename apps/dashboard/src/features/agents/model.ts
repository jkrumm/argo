import type { BadgeProps } from '@mantine/core'
import type { OverviewAgent, OverviewRecord, OverviewSnapshot } from '../../lib/queries/agents'

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
