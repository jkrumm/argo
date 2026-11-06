/**
 * How each payer's usage built up, week by week over the page range: one stacked bar per week, a
 * segment per payer in its hue, in the measure. Only payers with usage get a segment. The running
 * week is drawn lighter: it is not finished.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import type { Range } from '../../lib/queries/usage'
import type { UsageLens } from '../../lib/window-stores'
import type { PayerValue } from './accounts'
import { bucketToDate, colorForPayer } from './constants'
import {
  fmtUsdWhole,
  isRunningBucket,
  noDataInWindow,
  periodNoun,
  shortDay,
  tokensFormatterFor,
} from './model'
import type { TimePoint, WorkspaceValue } from './types'
import classes from './usage.module.css'

const HEIGHT = 240
const RUNNING_OPACITY = 0.45
const DONE_OPACITY = 0.9
/** Its own cursor: weekly buckets, never aligned with the Grain of the other time charts. */
const CURSOR_GROUP = 'usage-weekly'

const INFO =
  'Each bar is one week (starting Monday, UTC) over the page Range, split by payer. The Grain control does not apply: buckets are always weeks. Subscription dollars are list value, never charged; API and credit dollars are spend. Tokens are fresh tokens, cache-read left out. The lighter bar is the week still running.'

const total = (d: TimePoint): number =>
  Object.values(d.groups).reduce<number>((sum, v) => sum + (v ?? 0), 0)

export function WeeklyVolume({
  range,
  subs,
  lens,
  workspace,
  word = 'list value',
}: {
  range: Range
  /** The payers stacked (v6 passed the subscriptions; the Explore tab passes every payer). */
  subs: readonly { id: PayerValue; title: string }[]
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
  /** What `$` is called over these payers. */
  word?: string
}) {
  const cost = lens === 'cost'
  const now = useNow()
  const query = useSuspenseQuery(
    usageQueries.timeseries({
      range,
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
  const drawn = subs.filter((s) => query.data.groupKeys.includes(s.id))

  return (
    <Box data-shot="weekly-volume" data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        title={`Weekly volume · ${cost ? word : 'fresh tokens'} · ${periodNoun(range)}`}
        info={INFO}
        placeholderHeight={HEIGHT}
        state={{ empty: empty && noDataInWindow('usage', range) }}
      >
        <Bars
          ariaLabel={`${cost ? 'Dollars' : 'Fresh tokens'} per week, stacked by payer`}
          data={points}
          height={HEIGHT}
          x={(d) => d.date}
          formatX={(d) => shortDay(d)}
          cursorGroup={CURSOR_GROUP}
          cursorResolution="leading"
          bars={drawn.map((s) => ({
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
