/**
 * Spend or fresh tokens per day over the range, stacked by payer, tool, model or source (the legend
 * names the series; the API folds the tail into Other). The lens picks the metric. The figures live in
 * the headline above and the ranked lists below, so the chart carries no total of its own.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { USAGE_SOURCE } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import {
  usageStore,
  type UsageGroupBy,
  type UsageLens,
  type UsageScope,
} from '../../lib/window-stores'
import { scopePayers } from './budget-model'
import { RANK_PALETTE, colorForPayer, colorForSource, groupBands, toTimePoints } from './constants'
import {
  dropPartialBucket,
  fmtUsdWhole,
  noDataInWindow,
  periodNoun,
  shortDay,
  tokensFormatterFor,
} from './model'
import { isFoldKey, keyTotals, seriesLabel } from './over-time-model'
import { USAGE_TIME_GROUP } from './quota-model'
import type { TimePoint, WorkspaceValue } from './types'

/** Series the API keeps before folding the tail into `other`. */
const TOP_SERIES = 6

const GROUP_NOUN: Record<UsageGroupBy, string> = {
  sub_tool: 'tool',
  model_norm: 'model',
  source: 'source',
  payer: 'payer',
}

const INFO =
  'Dollars (Spend) or fresh tokens (Tokens) per day, stacked by the grouping on the right. Subscription usage is list value, not money paid. Fresh tokens leave out the tokens re-read from the cache.'

export function OverTime({
  range,
  grain,
  lens,
  scope,
  groupBy,
  workspace,
}: {
  range: Range
  grain: Grain
  lens: UsageLens
  scope: UsageScope
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
}) {
  const spend = lens === 'spend'
  const query = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: spend ? 'cost' : 'tokens',
      groupBy,
      payer: scopePayers(scope),
      workspace,
      top: TOP_SERIES,
    }),
  )
  const now = useNow()
  const data = shotState() === 'empty' ? { ...query.data, buckets: [], groupKeys: [] } : query.data
  const points = toTimePoints(data.buckets)
  const keys = data.groupKeys
  const colorOf = (key: string): string => {
    if (isFoldKey(key)) return USAGE_SOURCE.other
    if (groupBy === 'source') return colorForSource(key)
    if (groupBy === 'payer') return colorForPayer(key)
    return RANK_PALETTE[keys.indexOf(key) % RANK_PALETTE.length] ?? USAGE_SOURCE.other
  }
  // The chart stops at the last complete bucket: the running one would draw as a drop.
  const drawn = dropPartialBucket(points, now, grain)
  const peak = drawn.reduce(
    (max, p) =>
      Math.max(
        max,
        Object.values(p.groups).reduce<number>((s, v) => s + (v ?? 0), 0),
      ),
    0,
  )
  const format = spend ? fmtUsdWhole : tokensFormatterFor(peak)
  const series = groupBands(keys, colorOf, (k) => seriesLabel(groupBy, k), format)
  const total = keyTotals(points, keys).reduce((sum, t) => sum + t.value, 0)
  const perBucket = grain === 'day' ? 'day' : 'week'
  const what = spend ? (scope === 'all' ? 'Spend + list value' : 'Spend') : 'Fresh tokens'
  const emptyText = noDataInWindow('usage', range)

  return (
    <Box data-shot="over-time" data-shot-states="empty">
      <ChartCard
        title={`${what} per ${perBucket} · by ${GROUP_NOUN[groupBy]} · ${periodNoun(range)}`}
        info={INFO}
        actions={<ViewTabs field={usageStore.field.groupBy} label="Group by" />}
        state={{ empty: (keys.length === 0 || total <= 0 || drawn.length === 0) && emptyText }}
      >
        <StackedArea
          ariaLabel={`${what} per ${perBucket}, stacked by ${GROUP_NOUN[groupBy]}`}
          data={drawn}
          height={260}
          x={(d: TimePoint) => d.date}
          cursorResolution="leading"
          cursorGroup={USAGE_TIME_GROUP}
          series={series}
          formatX={(d) => shortDay(d)}
          y={{ format }}
          tooltip={{
            rows: (d) => [
              {
                label: 'Total',
                value: format(Object.values(d.groups).reduce<number>((s, v) => s + (v ?? 0), 0)),
              },
            ],
          }}
        />
      </ChartCard>
    </Box>
  )
}
