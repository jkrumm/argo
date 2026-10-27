/**
 * When each wallet was used: one heatmap, a row per wallet, a column per hour (the 7 d range) or day.
 * Every row is scaled to its own peak, because the wallets differ ~25× in dollars; the tooltip carries
 * the real figure in the measure, so the shade says "busy for this wallet" and the number says how
 * much.
 */
import { Box } from '@mantine/core'
import { ChartCard, Heatmap } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import type { Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import type { UsageLens } from '../../lib/window-stores'
import { PAYER_LABELS, type PayerValue } from './accounts'
import { dayColLabel, hourColLabel, whenCells, type WhenCell } from './heat-model'
import { fmtUsdWhole, noDataInWindow, periodNoun, tokensFormatterFor } from './model'

type Buckets = ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>

const INFO =
  'Each row is one wallet, scaled to its own busiest bucket: the darker the cell, the closer to that wallet’s peak. Rows are not comparable in shade, the tooltip names the real figure. Hours (local time) for 7 d, days beyond.'

const labelOf = (id: string): string => PAYER_LABELS[id as PayerValue] ?? id

export function When({
  range,
  lens,
  rows,
  buckets,
}: {
  range: Range
  lens: UsageLens
  rows: readonly string[]
  buckets: Buckets
}) {
  const hourly = range === '7d'
  const data = shotState() === 'empty' ? [] : whenCells(buckets, rows)
  const cols = buckets.map((b) => b.bucket)
  const peak = data.reduce((max, c) => Math.max(max, c.actual), 0)
  const real = lens === 'cost' ? fmtUsdWhole : tokensFormatterFor(peak)
  const empty = data.every((c) => c.actual <= 0)

  return (
    <Box data-shot="when" data-shot-states="empty">
      <ChartCard
        title={`When · ${hourly ? 'per hour' : 'per day'} · ${periodNoun(range)}`}
        info={INFO}
        placeholderHeight="content"
        state={{ empty: empty && noDataInWindow('usage', range) }}
      >
        <Heatmap<WhenCell>
          ariaLabel={`Usage per ${hourly ? 'hour' : 'day'} for each wallet, each row scaled to its own peak`}
          data={data}
          getRow={(c) => c.row}
          getCol={(c) => c.col}
          getValue={(c) => c.scaled}
          rows={rows}
          cols={cols}
          domain={[0, 1]}
          formatRow={labelOf}
          formatCol={hourly ? hourColLabel : dayColLabel}
          formatValue={(v) => `${Math.round(v * 100)}%`}
          formatLegend={(v) => `${Math.round(v * 100)}%`}
          legend={{ label: 'Of the wallet’s own peak' }}
          color={VX.line}
          tooltip={{
            valueLabel: 'Of its peak',
            rows: (c) => [{ label: labelOf(c.row), value: real(c.actual) }],
          }}
          height={rows.length * 36 + 44}
        />
      </ChartCard>
    </Box>
  )
}
