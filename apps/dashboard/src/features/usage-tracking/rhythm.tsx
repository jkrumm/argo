/**
 * A scope's rhythm (every wallet, the Claude Max selection or the IU API): when in the day and in
 * the week the work happens, as two plain bar charts summed over the range in the browser's time
 * zone, in the measure. How much per day lives in the other charts.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid, Stack, Text } from '@mantine/core'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import type { UsageLens } from '../../lib/window-stores'
import type { Scope } from './scope'
import { busiestSlot, hourTotals, rhythmCells, weekdayTotals, type Slot } from './heat-model'
import { noDataInWindow, periodNoun, tokensFormatterFor, usdFormatterFor } from './model'
import type { WorkspaceValue } from './types'

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const HEIGHT = 160

const INFO =
  'When the usage happens, in your time zone: the left chart sums every day of the range by hour of day, the right one by weekday. Taller is busier in the measure.'

function SlotBars({
  label,
  slots,
  color,
  format,
}: {
  label: string
  slots: readonly Slot[]
  color: string
  format: (v: number) => string
}) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Bars<Slot, string>
        ariaLabel={label}
        data={slots}
        height={HEIGHT}
        x={(s) => s.label}
        legend={false}
        y={{ format }}
        bars={[
          { key: 'value', label: 'Usage', color, getValue: (s) => s.value, formatValue: format },
        ]}
      />
    </Stack>
  )
}

export function Rhythm({
  scope,
  range,
  lens,
  workspace,
}: {
  scope: Scope
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.rhythm({
      range,
      metric: lens === 'cost' ? 'cost' : 'tokens',
      tz: TZ,
      payer: scope.payers,
      workspace,
    }),
  )
  const cells = shotState() === 'empty' ? [] : rhythmCells(query.data.cells)
  const hours = hourTotals(cells)
  const days = weekdayTotals(cells)
  const peakOf = (slots: readonly Slot[]) => slots.reduce((max, s) => Math.max(max, s.value), 0)
  // Each chart formats from its own largest value: cents under ten dollars, the token unit that fits.
  const formatOf = (slots: readonly Slot[]) =>
    lens === 'cost' ? usdFormatterFor(peakOf(slots)) : tokensFormatterFor(peakOf(slots))
  const hourFormat = formatOf(hours)
  const dayFormat = formatOf(days)
  const busiestHour = busiestSlot(hours)
  const busiestDay = busiestSlot(days)

  return (
    <Box data-shot={`rhythm-${scope.id}`} data-shot-states="empty">
      <ChartCard
        title={`Time of day and week · ${periodNoun(range)}`}
        info={INFO}
        subtitle={`Summed over the range · ${query.data.tz}`}
        state={{ empty: busiestHour === null && noDataInWindow('usage', range) }}
        {...(busiestHour === null || busiestDay === null
          ? {}
          : {
              facts: {
                value: `${busiestHour.label}:00`,
                period: `busiest hour · ${busiestDay.label} busiest day`,
              },
            })}
      >
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <SlotBars
              label="By hour of day"
              slots={hours}
              color={scope.color}
              format={hourFormat}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <SlotBars label="By weekday" slots={days} color={scope.color} format={dayFormat} />
          </Grid.Col>
        </Grid>
      </ChartCard>
    </Box>
  )
}
