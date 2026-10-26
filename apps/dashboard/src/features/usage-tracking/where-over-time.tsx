/**
 * Section A, where it goes over time: a stacked area with a ranked list beside it that keys it. The
 * Spend lens stacks dollars by tool / model / source / payer; the API folds the tail (`top=6`), so
 * the chart and the list read the same at most seven series. The Tokens lens stacks the four token
 * classes, cache-read as its own series and never added to fresh. Subscription rows (scope `+
 * subscriptions`) are list value: a labelled line under the list, never inside a stack or its total.
 */
import { useQuery, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea, type StackedAreaBand } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { USAGE_SOURCE, USAGE_TOKEN } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import {
  usageStore,
  type UsageGroupBy,
  type UsageLens,
  type UsageScope,
} from '../../lib/window-stores'
import { flowLensOf, scopePayers, tokenTrio } from './budget-model'
import { RANK_PALETTE, colorForPayer, colorForSource, groupBands, toTimePoints } from './constants'
import {
  EM_DASH,
  dropPartialBucket,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  noDataInWindow,
  periodNoun,
  shortDay,
  tokensFormatterFor,
  SPEND_NOUN,
} from './model'
import {
  TOKEN_CLASSES,
  isFoldKey,
  keyTotals,
  peakProcessed,
  processedOf,
  seriesLabel,
  tokenPoints,
  tokenTotals,
  type TokenClass,
  type TokenPoint,
} from './over-time-model'
import { USAGE_TIME_GROUP } from './quota-model'
import type { TimePoint, WorkspaceValue } from './types'
import classes from './usage.module.css'

/** Series the API keeps before folding the tail into `other`. */
const TOP_SERIES = 6
const CHART_HEIGHT = 280

type Props = {
  range: Range
  grain: Grain
  scope: UsageScope
  workspace: WorkspaceValue[] | undefined
}

const SCOPE_NOUN: Record<UsageScope, string> = {
  'iu-api': 'IU API',
  api: 'all API',
  all: 'all API',
}

const GROUP_NOUN: Record<UsageGroupBy, string> = {
  sub_tool: 'tool',
  model_norm: 'model',
  source: 'source',
  payer: 'payer',
}

const SUBSCRIPTION_PAYERS = ['iu-sub', 'me-sub'] as const

/**
 * The Max subscriptions' list value in the window, only while the scope asks for it. Shown as a
 * labelled line: it is what the plans saved, not what anyone paid, so it never joins a total.
 */
function useSubscriptionValue({ range, scope, workspace }: Props, lens: UsageLens) {
  const query = useQuery({
    ...usageQueries.flow({
      range,
      lens: flowLensOf(lens),
      payer: [...SUBSCRIPTION_PAYERS],
      workspace,
    }),
    enabled: scope === 'all',
  })
  if (scope !== 'all' || query.data === undefined) return null
  const rows = query.data.rows
  const cost = rows.reduce((sum, r) => sum + r.cost, 0)
  const fresh = rows.reduce((sum, r) => sum + tokenTrio(r).fresh, 0)
  const cacheRead = rows.reduce((sum, r) => sum + r.cacheRead, 0)
  return { cost, fresh, cacheRead, empty: rows.length === 0 }
}

type ListItem = { key: string; label: string; value: number; color: string }

function SeriesList({
  title,
  label,
  items,
  total,
  format,
  note,
  emptyText,
}: {
  title: string
  label: string
  items: readonly ListItem[]
  total: number
  format: (n: number) => string
  note: string | null
  emptyText: string | false
}) {
  return (
    <ChartCard
      className={classes.fill}
      placeholderHeight="content"
      title={title}
      state={{ empty: emptyText }}
    >
      <BarList
        label={label}
        format={format}
        items={items.map((t) => ({
          key: t.key,
          label: t.label,
          value: t.value,
          secondary: (
            <span className={classes.share}>
              <Box component="span" className={classes.swatch} bg={t.color} />
              {total > 0 ? fmtShare(t.value / total) : EM_DASH}
            </span>
          ),
        }))}
      />
      {note !== null && (
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      )}
    </ChartCard>
  )
}

const SPEND_INFO =
  'API spend in US dollars, added up per day or week. The largest series in the window are named, the rest are grouped as Other. Subscription usage is list value, not spend, and is never part of this total.'

const TOKENS_INFO =
  'Tokens by class. Cache-read is tokens re-read from the cache: most of the volume, billed at a fraction of input, and its own series. Fresh is input, output and cache-write. The tooltip total is everything processed (fresh plus cache-read).'

function SpendOverTime(props: Props & { groupBy: UsageGroupBy }) {
  const { range, grain, scope, workspace, groupBy } = props
  // Under `+ subscriptions` the stack stays API spend; the plans' list value is the labelled line.
  const payer = scopePayers(scope === 'all' ? 'api' : scope)
  const query = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: 'cost',
      groupBy,
      payer,
      workspace,
      top: TOP_SERIES,
    }),
  )
  const subscriptions = useSubscriptionValue(props, 'spend')
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
  const labelOf = (key: string) => seriesLabel(groupBy, key)
  const totals = keyTotals(points, keys)
  const total = totals.reduce((sum, t) => sum + t.value, 0)
  // The chart stops at the last complete bucket; the list and the header keep the whole window.
  const drawn = dropPartialBucket(points, now, grain)
  const series = groupBands(keys, colorOf, labelOf, fmtUsdWhole)
  const perBucket = grain === 'day' ? 'day' : 'week'
  const noun = GROUP_NOUN[groupBy]
  const empty = keys.length === 0 || total <= 0
  const emptyText = noDataInWindow('usage', range)

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 8 }} data-shot="where-chart" data-shot-states="empty">
        <ChartCard
          className={classes.fill}
          title={`Spend per ${perBucket} · by ${noun} · ${periodNoun(range)}`}
          info={SPEND_INFO}
          facts={{ value: fmtUsdWhole(total), period: [SPEND_NOUN[scope], periodNoun(range)] }}
          actions={<ViewTabs field={usageStore.field.groupBy} label="Group by" />}
          state={{ empty: (empty || drawn.length === 0) && emptyText }}
        >
          <StackedArea
            ariaLabel={`Spend per ${perBucket}, stacked by ${noun}`}
            data={drawn}
            height={CHART_HEIGHT}
            x={(d: TimePoint) => d.date}
            cursorResolution="leading"
            cursorGroup={USAGE_TIME_GROUP}
            series={series}
            legend={false}
            formatX={(d) => shortDay(d)}
            y={{ format: fmtUsdWhole }}
            tooltip={{
              rows: (d) => [
                {
                  label: 'Total',
                  value: fmtUsdWhole(
                    Object.values(d.groups).reduce<number>((sum, v) => sum + (v ?? 0), 0),
                  ),
                },
              ],
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }} data-shot="where-list" data-shot-states="empty">
        <SeriesList
          title={`Spend by ${noun} · ${periodNoun(range)}`}
          label={`Spend by ${noun}, ${periodNoun(range)}`}
          items={totals.map((t) => ({ ...t, label: labelOf(t.key), color: colorOf(t.key) }))}
          total={total}
          format={fmtUsdWhole}
          note={
            subscriptions === null || subscriptions.empty
              ? null
              : `Max subscriptions: ${fmtUsdWhole(subscriptions.cost)} list value, not spend and not in the total`
          }
          emptyText={empty && emptyText}
        />
      </Grid.Col>
    </Grid>
  )
}

const TOKEN_LABELS: Record<TokenClass, string> = {
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  input: 'Fresh input',
  output: 'Output',
}

/** Bottom to top: the fresh classes sit on the baseline, the cache-read volume on top. */
const TOKEN_STACK: readonly TokenClass[] = ['output', 'input', 'cacheWrite', 'cacheRead']

const tokenColor = (cls: TokenClass): string => USAGE_TOKEN[cls]

function TokensOverTime(props: Props) {
  const { range, grain, scope, workspace } = props
  const payer = scopePayers(scope === 'all' ? 'api' : scope)
  const base = { range, grain, groupBy: 'none', payer, workspace } as const
  const [input, output, cacheRead, cacheWrite] = useSuspenseQueries({
    queries: [
      usageQueries.timeseries({ ...base, metric: 'tokens_input' }),
      usageQueries.timeseries({ ...base, metric: 'tokens_output' }),
      usageQueries.timeseries({ ...base, metric: 'tokens_cache_read' }),
      usageQueries.timeseries({ ...base, metric: 'tokens_cache_write' }),
    ],
  })
  const subscriptions = useSubscriptionValue(props, 'tokens')
  const now = useNow()
  const empty = shotState() === 'empty'
  const points: TokenPoint[] = empty
    ? []
    : tokenPoints({
        input: input.data.buckets,
        output: output.data.buckets,
        cacheRead: cacheRead.data.buckets,
        cacheWrite: cacheWrite.data.buckets,
      })
  const totals = tokenTotals(points)
  const drawn = dropPartialBucket(points, now, grain)
  const format = tokensFormatterFor(peakProcessed(drawn))
  const listFormat = tokensFormatterFor(totals.processed)
  const bands: StackedAreaBand<TokenPoint>[] = TOKEN_STACK.map((cls) => ({
    key: cls,
    label: TOKEN_LABELS[cls],
    color: tokenColor(cls),
    getValue: (d) => d[cls],
    formatValue: format,
  }))
  const perBucket = grain === 'day' ? 'day' : 'week'
  const noData = totals.processed <= 0
  const emptyText = noDataInWindow('usage', range)

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 8 }} data-shot="where-chart" data-shot-states="empty">
        <ChartCard
          className={classes.fill}
          title={`Tokens per ${perBucket} · by class · ${periodNoun(range)}`}
          info={TOKENS_INFO}
          facts={[
            { value: fmtTokens(totals.fresh), period: ['fresh', SCOPE_NOUN[scope]] },
            { value: `+ ${fmtTokens(totals.cacheRead)}`, period: 'cache-read', tone: 'muted' },
          ]}
          state={{ empty: (noData || drawn.length === 0) && emptyText }}
        >
          <StackedArea
            ariaLabel={`Tokens per ${perBucket}, stacked by token class`}
            data={drawn}
            height={CHART_HEIGHT}
            x={(d: TokenPoint) => d.date}
            cursorResolution="leading"
            cursorGroup={USAGE_TIME_GROUP}
            series={bands}
            legend={false}
            formatX={(d) => shortDay(d)}
            y={{ format }}
            tooltip={{
              rows: (d) => [{ label: 'Processed', value: fmtTokens(processedOf(d)) }],
            }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }} data-shot="where-list" data-shot-states="empty">
        <SeriesList
          title={`Tokens by class · ${periodNoun(range)}`}
          label={`Tokens by class, ${periodNoun(range)}`}
          items={[...TOKEN_CLASSES]
            .map((cls) => ({
              key: cls,
              label: TOKEN_LABELS[cls],
              value: totals[cls],
              color: tokenColor(cls),
            }))
            .toSorted((a, b) => b.value - a.value)}
          total={totals.processed}
          format={listFormat}
          note={
            subscriptions === null || subscriptions.empty
              ? null
              : `Max subscriptions: ${fmtTokens(subscriptions.fresh)} fresh + ${fmtTokens(subscriptions.cacheRead)} cache-read, list value, not in the total`
          }
          emptyText={noData && emptyText}
        />
      </Grid.Col>
    </Grid>
  )
}

export function WhereOverTime({
  lens,
  groupBy,
  ...props
}: Props & { lens: UsageLens; groupBy: UsageGroupBy }) {
  return lens === 'spend' ? (
    <SpendOverTime {...props} groupBy={groupBy} />
  ) : (
    <TokensOverTime {...props} />
  )
}
