/**
 * One wallet's rhythm: a weekday × hour-of-day heatmap over the range, in the browser's time zone,
 * in the measure. Shows when in the week the wallet works, not how much per day.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { ChartCard, Heatmap } from 'basalt-ui/charts'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import type { UsageLens } from '../../lib/window-stores'
import type { Wallet } from './accounts'
import { colorForPayer } from './constants'
import { DAYS, HOURS, busiestCell, rhythmCells, type RhythmCell } from './heat-model'
import { fmtUsdWhole, noDataInWindow, periodNoun, tokensFormatterFor } from './model'
import type { WorkspaceValue } from './types'

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const HEIGHT = 200

const INFO =
  'Usage by weekday and hour of day over the range, in your time zone. A darker cell is a busier hour in the measure; the legend names the scale.'

export function Rhythm({
  wallet,
  range,
  lens,
  workspace,
}: {
  wallet: Wallet
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.rhythm({
      range,
      metric: lens === 'cost' ? 'cost' : 'tokens',
      tz: TZ,
      payer: [wallet.id],
      workspace,
    }),
  )
  const cells = shotState() === 'empty' ? [] : rhythmCells(query.data.cells)
  const peak = cells.reduce((max, c) => Math.max(max, c.value), 0)
  const format = lens === 'cost' ? fmtUsdWhole : tokensFormatterFor(peak)
  const busiest = busiestCell(cells)

  return (
    <Box data-shot={`rhythm-${wallet.id}`} data-shot-states="empty">
      <ChartCard
        title={`Rhythm · weekday × hour · ${periodNoun(range)}`}
        info={INFO}
        subtitle={`Time zone ${query.data.tz}`}
        state={{ empty: busiest === null && noDataInWindow('usage', range) }}
        {...(busiest === null
          ? {}
          : {
              facts: {
                value: `${busiest.day} ${busiest.hour}:00`,
                period: `busiest hour · ${format(busiest.value)}`,
              },
            })}
      >
        <Heatmap<RhythmCell>
          ariaLabel={`${wallet.title} usage by weekday and hour of day`}
          data={cells}
          getRow={(c) => c.day}
          getCol={(c) => c.hour}
          getValue={(c) => c.value}
          rows={DAYS}
          cols={HOURS}
          color={colorForPayer(wallet.id)}
          formatValue={format}
          formatLegend={format}
          formatCol={(h) => `${h}:00`}
          legend={{ label: lens === 'cost' ? '$ per hour of week' : 'Fresh tokens' }}
          height={HEIGHT}
        />
      </ChartCard>
    </Box>
  )
}
