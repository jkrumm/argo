/**
 * A stacked area folded to its top series (at least 6, more while the rest would outweigh the smallest) plus "Other", with the ranked list that keys it. The list
 * and the chart read the same folded totals, so a swatch, a bar and an area band are the same series
 * and the header total equals the list's sum. Used for cost (by source / machine / billing) and tokens
 * (by tool / model / project / source).
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid, Text, UnstyledButton } from '@mantine/core'
import { BarList, useSizeClass } from 'basalt-ui'
import { ViewTabs } from 'basalt-ui/controls'
import { ChartCard, StackedArea } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { useState } from 'react'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Grain, type Metric, type Range } from '../../lib/queries/usage'
import { USAGE_SOURCE } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import { usageStore } from '../../lib/window-stores'
import type { BillingValue, CostGroupBy, TokensGroupBy, WorkspaceValue } from './types'
import { RANK_PALETTE, toTimePoints, groupBands } from './constants'
import {
  peakBucketTotal,
  dropPartialBucket,
  EM_DASH,
  fmtShare,
  OTHER_KEY,
  periodNoun,
  prepareFolded,
  shortDay,
} from './model'
import classes from './usage.module.css'

/** Rows the list shows at phone width before "Show all". */
const COMPACT_ROWS = 5

type Props = {
  metric: Extract<Metric, 'cost' | 'tokens'>
  groupBy: CostGroupBy | TokensGroupBy
  groupNoun: string
  unitNoun: string
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  color: (key: string) => string
  /** Builds the surface's formatter from its largest value: one unit per chart and per list. */
  formatFor: (reference: number) => (n: number) => string
  info: string
  listTitle: string
  height?: number
  /** Whether the list header prints the window's total; decided once, in the route. */
  printTotal: boolean
}

export function FoldedChart({
  metric,
  groupBy,
  groupNoun,
  unitNoun,
  range,
  grain,
  billing,
  workspace,
  color,
  formatFor,
  info,
  listTitle,
  height = 280,
  printTotal,
}: Props) {
  const query = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric, groupBy, billing, workspace }),
  )
  const data = shotState() === 'empty' ? { ...query.data, buckets: [], groupKeys: [] } : query.data
  const now = useNow()
  const compact = useSizeClass() === 'compact'
  const [showAll, setShowAll] = useState(false)

  const { folded, labelOf } = prepareFolded({
    points: toTimePoints(data.buckets),
    groupKeys: data.groupKeys,
    groupBy,
  })
  // Open-ended keys (tool, model, project) take a palette slot by rank, not by hash, so the six
  // named series are always six different hues; source and billing keep their identity colours.
  const byRank = groupBy !== 'source' && groupBy !== 'billing'
  const colorOf = (key: string) => {
    if (key === OTHER_KEY) return USAGE_SOURCE.other
    if (!byRank) return color(key)
    return RANK_PALETTE[folded.keys.indexOf(key) % RANK_PALETTE.length] ?? USAGE_SOURCE.other
  }
  const rows = compact && !showAll ? folded.totals.slice(0, COMPACT_ROWS) : folded.totals
  const hidden = folded.totals.length - rows.length
  // The chart stops at the last complete bucket (the running one would draw as a drop); the list
  // keeps the whole window. The route decides whether the window's total is printed.
  // The card title's total and the list rows are one surface: one formatter, from the window total.
  const listFormat = formatFor(folded.total)
  const totalNote = printTotal ? ` · ${listFormat(folded.total)}` : ''
  const perBucket = grain === 'day' ? 'day' : 'week'
  const drawn = dropPartialBucket(folded.points, now, grain)
  const plotFormat = formatFor(peakBucketTotal(drawn))
  const series = groupBands(folded.keys, colorOf, labelOf, plotFormat)

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 8 }} data-shot={`${metric}-chart`}>
        <ChartCard
          title={`${unitNoun} per ${perBucket} · by ${groupNoun} · ${periodNoun(range)}`}
          info={info}
          actions={
            metric === 'cost' ? (
              <ViewTabs field={usageStore.field.costGroupBy} label="Group by" />
            ) : (
              <ViewTabs field={usageStore.field.tokensGroupBy} label="Group by" />
            )
          }
          state={{ empty: series.length === 0 || drawn.length === 0 }}
        >
          <StackedArea
            ariaLabel={`${unitNoun} per ${perBucket}, stacked by ${groupNoun}`}
            data={drawn}
            height={height}
            x={(d) => d.date}
            cursorResolution="leading"
            series={series}
            legend={false}
            formatX={(d) => shortDay(d)}
            y={{ format: plotFormat }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }} data-shot={`${metric}-list`}>
        <ChartCard title={`${listTitle} · ${periodNoun(range)}${totalNote}`}>
          <BarList
            label={`${unitNoun} by ${groupNoun}, ${periodNoun(range)}`}
            format={listFormat}
            emptyText="No data in this window"
            items={rows.map((t) => ({
              key: t.key,
              label: labelOf(t.key),
              value: t.value,
              secondary: (
                <span className={classes.share}>
                  <Box component="span" className={classes.swatch} bg={colorOf(t.key)} />
                  {folded.total > 0 ? fmtShare(t.value / folded.total) : EM_DASH}
                </span>
              ),
            }))}
          />
          {hidden > 0 && (
            <UnstyledButton onClick={() => setShowAll(true)}>
              <Text size="sm" c="dimmed">
                Show all {folded.totals.length}
              </Text>
            </UnstyledButton>
          )}
        </ChartCard>
      </Grid.Col>
    </Grid>
  )
}
