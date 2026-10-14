import { StatCard, StatGroup } from 'basalt-ui'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'
import {
  ABANDONED_AFTER_MS,
  formatWaitDuration,
  OLDEST_WAIT_WARN_MS,
  oldestNeedsYouWait,
  type AgentRow,
} from './model'

type Props = {
  summary: OverviewSummary | undefined
  history: HistoryPoint[] | undefined
  agents: AgentRow[]
}

// MIGRATION-STUB(w7): the 24 h trend sparklines under the Needs you / Active tiles (inventory a40)
// are dropped until their port to `Sparkline`; the tiles themselves are unchanged.
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
export function HeroStats({ summary, agents }: Props) {
  const needsYou = summary?.needsYou
  const working = summary?.working
  const oldest = oldestNeedsYouWait(agents)
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
      />
      <StatCard
        title="Oldest wait"
        value={oldest === null ? '—' : formatWaitDuration(oldest.ms)}
        {...(oldest !== null && { subtitle: oldest.project })}
        {...(oldestTone !== undefined && { tone: oldestTone })}
      />
      <StatCard title="Active" value={working === undefined ? '—' : String(working)} />
    </StatGroup>
  )
}
