/**
 * How each Claude Max subscription's usage built up, week by week over the whole history: one
 * stacked bar per week, a segment per subscription in its payer hue, in the measure. The running
 * week is drawn lighter: it is not finished.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import type { UsageLens } from '../../lib/window-stores'
import type { SubWallet } from './accounts'
import { bucketToDate, colorForPayer } from './constants'
import { fmtUsdWhole, isRunningBucket, noDataInWindow, shortDay, tokensFormatterFor } from './model'
import type { TimePoint, WorkspaceValue } from './types'
import classes from './usage.module.css'

const HEIGHT = 240
const RUNNING_OPACITY = 0.45
const DONE_OPACITY = 0.9
/** Its own cursor: the weeks span the whole history, the other time charts one range. */
const CURSOR_GROUP = 'usage-weekly'

const INFO =
  'Each bar is one week (starting Monday, UTC) over the whole history, split by subscription. The $ measure is list value: what the usage would cost at API prices, never charged. Tokens are fresh tokens, cache-read left out. The lighter bar is the week still running.'

const total = (d: TimePoint): number =>
  Object.values(d.groups).reduce<number>((sum, v) => sum + (v ?? 0), 0)

export function WeeklyVolume({
  subs,
  lens,
  workspace,
}: {
  subs: readonly SubWallet[]
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const cost = lens === 'cost'
  const now = useNow()
  const query = useSuspenseQuery(
    usageQueries.timeseries({
      range: 'all',
      grain: 'week',
      metric: cost ? 'cost' : 'tokens',
      groupBy: 'payer',
      payer: subs.map((s) => s.id),
      workspace,
    }),
  )
  const points: TimePoint[] =
    shotState() === 'empty'
      ? []
      : query.data.buckets.map((b) => ({ date: bucketToDate(b.bucket), groups: b.groups }))
  const peak = points.reduce((max, p) => Math.max(max, total(p)), 0)
  const format = cost ? fmtUsdWhole : tokensFormatterFor(Math.max(peak, 1))
  const empty = peak <= 0

  return (
    <Box data-shot="weekly-volume" data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        title={`Weekly volume · ${cost ? 'list value' : 'fresh tokens'} · all time`}
        info={INFO}
        placeholderHeight={HEIGHT}
        state={{ empty: empty && noDataInWindow('subscription usage', 'all') }}
      >
        <Bars
          ariaLabel={`${cost ? 'List value' : 'Fresh tokens'} per week, stacked by subscription`}
          data={points}
          height={HEIGHT}
          x={(d) => d.date}
          formatX={(d) => shortDay(d)}
          cursorGroup={CURSOR_GROUP}
          cursorResolution="leading"
          bars={subs.map((s) => ({
            key: s.id,
            label: s.title,
            color: colorForPayer(s.id),
            getValue: (d: TimePoint) => d.groups[s.id] ?? 0,
            formatValue: format,
          }))}
          barOpacity={(d) =>
            isRunningBucket(d.date, now, 'week') ? RUNNING_OPACITY : DONE_OPACITY
          }
          y={{ format }}
          tooltip={{ rows: (d) => [{ label: 'Total', value: format(total(d)) }] }}
        />
      </ChartCard>
    </Box>
  )
}
