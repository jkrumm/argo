/**
 * A scope's dollars or fresh tokens per hour, day or week over the range, stacked by tool, model,
 * project or (the Claude Max tab) subscription (the legend names the series; the API folds the tail
 * into Other). The measure picks
 * the metric. The figures live in the strip above and the ranked lists below, so the chart carries
 * no total of its own.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { USAGE_SOURCE } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import { usageStore, type UsageGroupBy, type UsageLens } from '../../lib/window-stores'
import { RANK_PALETTE, colorForPayer, groupBands, toTimePoints } from './constants'
import {
  dropPartialBucket,
  noDataInWindow,
  periodNoun,
  shortDay,
  shortHour,
  tokensFormatterFor,
  usdFormatterFor,
} from './model'
import { isFoldKey, keyTotals, seriesLabel } from './over-time-model'
import { pickOptions } from './pick-options'
import type { Scope } from './scope'
import { USAGE_TIME_GROUP } from './quota-model'
import type { TimePoint, WorkspaceValue } from './types'

/** Series the API keeps before folding the tail into `other`. */
const TOP_SERIES = 6

const GROUP_NOUN: Record<UsageGroupBy, string> = {
  sub_tool: 'tool',
  model_norm: 'model',
  project: 'project',
  payer: 'subscription',
}

const INFO =
  'Dollars at API prices ($: list value for a subscription, spend for the API) or fresh tokens (Tokens) per bucket, stacked by the grouping on the right. A subscription is never charged these dollars. Fresh tokens leave out the tokens re-read from the cache. The hour grain reads at most 30 days.'

export function OverTime({
  range,
  grain,
  lens,
  scope,
  groupBy,
  groupOptions,
  workspace,
}: {
  range: Range
  grain: Grain
  lens: UsageLens
  scope: Scope
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
  /** The tabs offered for the grouping: the IU API has no subscription split. */
  groupOptions: readonly UsageGroupBy[]
}) {
  const spend = lens === 'cost'
  const query = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: spend ? 'cost' : 'tokens',
      groupBy,
      payer: scope.payers,
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
    if (groupBy === 'payer') return colorForPayer(key)
    return RANK_PALETTE[keys.indexOf(key) % RANK_PALETTE.length] ?? USAGE_SOURCE.other
  }
  // The chart stops at the last complete bucket: the running one would draw as a drop.
  const stackOf = (p: TimePoint): number =>
    Object.values(p.groups).reduce<number>((s, v) => s + (v ?? 0), 0)
  const drawn = dropPartialBucket(points, now, grain, stackOf)
  const peak = drawn.reduce((max, p) => Math.max(max, stackOf(p)), 0)
  const format = spend ? usdFormatterFor(peak) : tokensFormatterFor(peak)
  const series = groupBands(keys, colorOf, (k) => seriesLabel(groupBy, k), format)
  const total = keyTotals(points, keys).reduce((sum, t) => sum + t.value, 0)
  // The API reads hourly series over 30 days at most.
  const shown = grain === 'hour' && (range === '90d' || range === 'all') ? '30d' : range
  const what = spend ? scope.word.charAt(0).toUpperCase() + scope.word.slice(1) : 'Fresh tokens'
  const formatBucket = grain === 'hour' ? shortHour : shortDay
  const emptyText = noDataInWindow('usage', range)

  return (
    <Box data-shot={`over-time-${scope.id}`} data-shot-states="empty">
      <ChartCard
        title={`${what} per ${grain} · by ${GROUP_NOUN[groupBy]} · ${periodNoun(shown)}`}
        info={INFO}
        actions={
          <ViewTabs
            field={usageStore.field.groupBy}
            options={pickOptions(usageStore.field.groupBy.options, groupOptions)}
            label="Group by"
          />
        }
        state={{ empty: (keys.length === 0 || total <= 0 || drawn.length === 0) && emptyText }}
      >
        <StackedArea
          ariaLabel={`${what} per ${grain}, stacked by ${GROUP_NOUN[groupBy]}`}
          data={drawn}
          height={260}
          x={(d: TimePoint) => d.date}
          cursorResolution="leading"
          cursorGroup={USAGE_TIME_GROUP}
          series={series}
          formatX={(d) => formatBucket(d)}
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
