/**
 * A stacked area folded to its top series (6 to 8) plus "Other", with the ranked list that keys it. The list
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
import {
  usageQueries,
  type Grain,
  type Metric,
  type Range,
  type TimeseriesGroupBy,
} from '../../lib/queries/usage'
import { USAGE_SOURCE } from '../../lib/series'
import { usageStore } from '../../lib/window-stores'
import type { BillingValue, WorkspaceValue } from './types'
import { RANK_PALETTE, toTimePoints, groupBands } from './constants'
import {
  EM_DASH,
  FOLD_MAX_N,
  FOLD_TOP_N,
  foldTopN,
  fmtShare,
  OTHER_KEY,
  periodNoun,
  regroup,
  toolGroupKey,
  toolLabel,
} from './model'
import classes from './usage.module.css'

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** Rows the list shows at phone width before "Show all". */
const COMPACT_ROWS = 5

type Props = {
  metric: Extract<Metric, 'cost' | 'tokens'>
  groupBy: TimeseriesGroupBy
  groupNoun: string
  unitNoun: string
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  color: (key: string) => string
  format: (n: number) => string
  info: string
  listTitle: string
  height?: number
  /** The strip's figure for this window, used as the header total when the page is unfiltered 30 d. */
  headlineTotal?: number | null | undefined
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
  format,
  info,
  listTitle,
  height = 280,
  headlineTotal,
}: Props) {
  const { data } = useSuspenseQuery(
    usageQueries.timeseries({ range, grain, metric, groupBy, billing, workspace }),
  )
  const compact = useSizeClass() === 'compact'
  const [showAll, setShowAll] = useState(false)

  // Tools are counted per MCP server (not per call name) and shown in words; other dimensions as sent.
  const tools = groupBy === 'sub_tool'
  const raw = toTimePoints(data.buckets)
  const source = tools
    ? regroup(raw, data.groupKeys, toolGroupKey)
    : { points: raw, groupKeys: data.groupKeys }
  const labelOf = (key: string) => (tools ? toolLabel(key) : key)
  const folded = foldTopN(source.points, source.groupKeys, FOLD_TOP_N, FOLD_MAX_N)
  // Open-ended keys (tool, model, project) take a palette slot by rank, not by hash, so the six
  // named series are always six different hues; source and billing keep their identity colours.
  const byRank = groupBy !== 'source' && groupBy !== 'billing'
  const colorOf = (key: string) => {
    if (key === OTHER_KEY) return USAGE_SOURCE.other
    if (!byRank) return color(key)
    return RANK_PALETTE[folded.keys.indexOf(key) % RANK_PALETTE.length] ?? USAGE_SOURCE.other
  }
  const series = groupBands(folded.keys, colorOf, labelOf)
  const rows = compact && !showAll ? folded.totals.slice(0, COMPACT_ROWS) : folded.totals
  const hidden = folded.totals.length - rows.length
  // Unfiltered 30 d is the strip's own window: print its figure so the page never shows two totals
  // for one quantity (the buckets are cut a few minutes later than the headline's rolling window).
  const unfiltered = range === '30d' && billing === undefined && workspace === undefined
  const total = unfiltered && headlineTotal != null ? headlineTotal : folded.total
  const perBucket = grain === 'day' ? 'day' : 'week'

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 8 }} data-shot={`${metric}-chart`}>
        <ChartCard
          title={`${unitNoun} per ${perBucket} · by ${groupNoun} · ${format(total)} in ${periodNoun(range)}`}
          info={info}
          actions={
            metric === 'cost' ? (
              <ViewTabs field={usageStore.field.costGroupBy} label="Group by" />
            ) : (
              <ViewTabs field={usageStore.field.tokensGroupBy} label="Group by" />
            )
          }
          state={{ empty: series.length === 0 }}
        >
          <StackedArea
            ariaLabel={`${unitNoun} per ${perBucket}, stacked by ${groupNoun}`}
            data={folded.points}
            height={height}
            x={(d) => d.date}
            cursorResolution="leading"
            series={series}
            legend={false}
            formatX={(d) => dayFormat.format(d)}
            y={{ format }}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }} data-shot={`${metric}-list`}>
        <ChartCard title={`${listTitle} · ${periodNoun(range)} · ${format(total)}`}>
          <BarList
            label={`${unitNoun} by ${groupNoun}, ${periodNoun(range)}`}
            format={format}
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
