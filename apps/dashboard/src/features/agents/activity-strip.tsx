import { withUnit } from '../../lib/format'
import { useMemo } from 'react'
import { Box, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { BandStrip } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { BandSpan } from 'basalt-ui/charts'
import type { HistoryPoint } from '../../lib/queries/agents'
import {
  activityFact,
  clockOf,
  gapHours,
  hourlyWorking,
  peakWorking,
  type HourBucket,
} from './model'

type Props = {
  history: HistoryPoint[] | undefined
  hours: number
  now: number
}

const SIX_HOURS = 6

/** The legend names the scale in data terms: the lightest and the strongest cell, by agents working. */
const statesFor = (peak: number) =>
  [
    // At a peak of zero nothing was ever working: no cell carries that colour, so no entry names it.
    ...(peak > 0
      ? [
          {
            key: 'working',
            label: peak === 1 ? '1 agent working' : `1 to ${peak} agents working`,
            color: VX.line,
            formatValue: (d: HourBucket) =>
              `${d.working ?? 0} ${d.working === 1 ? 'agent' : 'agents'}`,
          },
        ]
      : []),
    {
      key: 'quiet',
      label: 'None working',
      color: alpha(VX.line, 0.1),
      formatValue: () => '0 agents',
    },
    { key: 'gap', label: 'No snapshot', color: alpha(VX.status.warn, 0.35) },
  ] as const

/**
 * Agents working per hour over the window: one cell per hour, intensity = the hour's peak working
 * count, a distinct flat cell where no snapshot landed (a feed stall shows as a hole, not a zero).
 * The legend names the three kinds of cell; an hour still in progress with no snapshot is not drawn.
 */
export function ActivityStrip({ history, hours, now }: Props) {
  const { buckets, peakHour, fact } = useMemo(() => {
    const hourly = hourlyWorking(history, hours, now)
    const busiest = peakWorking(hourly)
    return { buckets: hourly, peakHour: busiest, fact: activityFact(hourly, busiest) }
  }, [history, hours, now])
  // The hour in progress with no snapshot yet is not a gap and not yet an hour: it is left off.
  const currentHourMs = buckets.at(-1)?.hourMs
  const shown = buckets.filter((b) => !(b.hourMs === currentHourMs && b.working === null))
  const gaps = gapHours(shown, now)
  const peak = peakHour?.value ?? 0

  const getBand = useMemo(
    () =>
      (d: HourBucket): BandSpan => {
        if (d.working === null) return { state: 'gap' }
        if (d.working === 0) return { state: 'quiet' }
        return { state: 'working', fill: alpha(VX.line, 0.25 + 0.75 * (d.working / peak)) }
      },
    [peak],
  )
  const ticks = shown
    .filter((b) => new Date(b.hourMs).getHours() % SIX_HOURS === 0)
    .map((b) => b.hourMs)

  return (
    <Section
      title={`Last ${withUnit(hours, 'h')} · agents working per hour`}
      value={peakHour === null ? '—' : String(peak)}
      {...(peakHour !== null && { unit: 'agents at peak' })}
    >
      <Box data-shot="activity-strip" pt="lg">
        <BandStrip
          ariaLabel={`Agents working per hour over the last ${hours} hours`}
          data={shown}
          x={(d) => d.hourMs}
          xTicks={ticks}
          formatX={clockOf}
          states={statesFor(peak)}
          getBand={getBand}
          height={48}
        />
        <Text size="sm" ff="monospace" c="dimmed" mt="xs">
          {fact ?? `No snapshot in the last ${withUnit(hours, 'h')}`}
        </Text>
        {fact !== null && gaps > 0 ? (
          <Text size="xs" c="dimmed" mt="xs">
            {gaps} {gaps === 1 ? 'hour' : 'hours'} without a snapshot
          </Text>
        ) : null}
      </Box>
    </Section>
  )
}
