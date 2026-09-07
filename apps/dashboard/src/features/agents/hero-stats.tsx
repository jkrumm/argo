import { StatCard, StatGroup } from 'basalt-ui'
import { LineSparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'

type Props = {
  summary: OverviewSummary | undefined
  history: HistoryPoint[] | undefined
}

// The literal keys, not `keyof OverviewSummary`: the API validates the summary as a LOOSE object,
// so its inferred type carries a string index signature and `keyof` would collapse to `string`.
type SummaryKey = 'needsYou' | 'working' | 'idle' | 'stale' | 'done' | 'dispatch'

const COUNTS: { key: SummaryKey; title: string }[] = [
  { key: 'needsYou', title: 'Needs you' },
  { key: 'working', title: 'Working' },
  { key: 'idle', title: 'Idle' },
  { key: 'stale', title: 'Stale' },
  { key: 'done', title: 'Done' },
  { key: 'dispatch', title: 'Dispatch' },
]

function series(history: HistoryPoint[] | undefined, key: SummaryKey): number[] {
  return (history ?? []).map((p) => p.summary?.[key] ?? 0)
}

/**
 * The six state counts of the latest snapshot. `needsYou` and `working` carry the 24 h sparkline
 * (the two counts that move); a tone is only asserted where a count is a verdict — agents waiting
 * on the human, or gone stale — never on the neutral ones.
 */
export function HeroStats({ summary, history }: Props) {
  return (
    <StatGroup cols={3}>
      {COUNTS.map(({ key, title }) => {
        const value = summary?.[key]
        const trend = key === 'needsYou' || key === 'working' ? series(history, key) : null
        const tone =
          value !== undefined && value > 0 && (key === 'needsYou' || key === 'stale')
            ? ('warn' as const)
            : undefined
        return (
          <StatCard
            key={key}
            title={title}
            value={value === undefined ? '—' : String(value)}
            {...(tone && { tone })}
            {...(trend &&
              trend.length > 1 && {
                subtitle: 'last 24 h',
                sparkline: ({ width, height }: { width: number; height: number }) => (
                  <LineSparkline
                    data={trend}
                    width={width}
                    height={height}
                    color={VX.line}
                    ariaLabel={`${title} over the last 24 hours`}
                  />
                ),
              })}
          />
        )
      })}
    </StatGroup>
  )
}
