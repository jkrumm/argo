import { StatCard, StatGroup } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'
import {
  ABANDONED_AFTER_MS,
  formatWaitDuration,
  OLDEST_WAIT_WARN_MS,
  oldestNeedsYouWait,
  trendSeries,
  type AgentRow,
} from './model'

type Props = {
  summary: OverviewSummary | undefined
  history: HistoryPoint[] | undefined
  hours: number
  agents: AgentRow[]
}

function sparklineSlot(title: string, trend: number[], hours: number) {
  if (trend.length <= 1) return {}
  return {
    subtitle: `last ${hours} h`,
    sparkline: ({ width, height }: { width: number; height: number }) => (
      <Sparkline
        data={trend}
        width={width}
        height={height}
        color={VX.line}
        ariaLabel={`${title} over the last ${hours} hours`}
      />
    ),
  }
}

/**
 * Three verdict tiles, replacing the old six raw state counts (`needsYou, working, idle, stale,
 * done, dispatch`). Two faults drove the cut: `dispatch` counted `source === 'dispatch'` and so
 * double-counted working/done entries rather than partitioning the agent count, and `idle`/`done`
 * sit near-constant on a quiet machine — neither carries a decision. Only `needsYou` and `working`
 * survive as counts; `idle`/`done`/`stale` are still reachable as plain text in the agents
 * list/table subtitle (`agents-table.tsx#overviewLine`). The number the old six could never
 * express — HOW LONG the current needs-you items have waited — is its own tile now: `needsYou: 1`
 * reads identically whether that one item has waited five minutes or 21 days.
 */
export function HeroStats({ summary, history, hours, agents }: Props) {
  const needsYou = summary?.needsYou
  const working = summary?.working
  const oldest = oldestNeedsYouWait(agents, useNow())
  const oldestTone =
    oldest === null
      ? undefined
      : oldest.ms > ABANDONED_AFTER_MS
        ? ('bad' as const)
        : oldest.ms > OLDEST_WAIT_WARN_MS
          ? ('warn' as const)
          : undefined

  return (
    <StatGroup cols={3}>
      <StatCard
        title="Needs you"
        value={needsYou === undefined ? '—' : String(needsYou)}
        {...(needsYou !== undefined && needsYou > 0 && { tone: 'warn' as const })}
        {...sparklineSlot('Needs you', trendSeries(history, 'needsYou'), hours)}
      />
      <StatCard
        title="Oldest wait"
        value={oldest === null ? '—' : formatWaitDuration(oldest.ms)}
        {...(oldest !== null && { subtitle: oldest.project })}
        {...(oldestTone !== undefined && { tone: oldestTone })}
      />
      <StatCard
        title="Active"
        value={working === undefined ? '—' : String(working)}
        {...sparklineSlot('Active', trendSeries(history, 'working'), hours)}
      />
    </StatGroup>
  )
}
