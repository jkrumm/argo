import { useMemo } from 'react'
import { Box, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { BandStrip } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { BandSpan } from 'basalt-ui/charts'
import type { HistoryPoint } from '../../lib/queries/agents'
import { gapHours, hourlyWorking, peakWorking, type HourBucket } from './model'

type Props = {
  history: HistoryPoint[] | undefined
  hours: number
  now: number
}

const SIX_HOURS = 6

const plural = (n: number) => `${n} ${n === 1 ? 'agent' : 'agents'}`

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const STATES = [
  {
    key: 'working',
    label: 'Working (hourly peak)',
    color: VX.line,
    formatValue: (d: HourBucket) => `${d.working ?? 0} agents`,
  },
  {
    key: 'quiet',
    label: 'None working',
    color: alpha(VX.line, 0.1),
    formatValue: () => '0 agents',
  },
  { key: 'gap', label: 'No snapshot', color: alpha(VX.status.warn, 0.35) },
  { key: 'pending', label: 'Hour in progress, no snapshot yet', color: alpha(VX.line, 0.05) },
] as const

/**
 * Agents working per hour over the window: one cell per hour, intensity = the hour's peak working
 * count, a distinct flat cell where no snapshot landed (a feed stall shows as a hole, not a zero).
 */
export function ActivityStrip({ history, hours, now }: Props) {
  const { buckets, peakHour } = useMemo(() => {
    const hourly = hourlyWorking(history, hours, now)
    return { buckets: hourly, peakHour: peakWorking(hourly) }
  }, [history, hours, now])
  const currentHourMs = buckets.at(-1)?.hourMs
  const gaps = gapHours(buckets, now)
  const peak = peakHour?.value ?? 0
  const latest = buckets.at(-1)?.working ?? null
  const latestHour = latest === null ? '—' : plural(latest)

  const getBand = useMemo(
    () =>
      (d: HourBucket): BandSpan => {
        if (d.working === null) return { state: d.hourMs === currentHourMs ? 'pending' : 'gap' }
        if (d.working === 0) return { state: 'quiet' }
        return { state: 'working', fill: alpha(VX.line, 0.25 + 0.75 * (d.working / peak)) }
      },
    [peak, currentHourMs],
  )
  const ticks = buckets
    .filter((b) => new Date(b.hourMs).getHours() % SIX_HOURS === 0)
    .map((b) => b.hourMs)

  return (
    <Section
      title="Last 24 h · agents working per hour"
      value={peakHour === null ? '—' : String(peak)}
      {...(peakHour !== null && { unit: 'agents at peak' })}
    >
      <Box data-shot="activity-strip" pt="lg">
        <BandStrip
          ariaLabel={`Agents working per hour over the last ${hours} hours`}
          data={buckets}
          x={(d) => d.hourMs}
          xTicks={ticks}
          formatX={clock}
          states={STATES}
          getBand={getBand}
          legend={false}
          height={48}
        />
        <Text size="sm" ff="monospace" c="dimmed" mt="xs">
          {peakHour === null
            ? 'No snapshot in the window'
            : `peak ${plural(peak)} at ${clock(peakHour.hourMs)} · latest hour ${latestHour}`}
        </Text>
        {gaps > 0 ? (
          <Text size="xs" c="dimmed" mt="xs">
            {gaps} {gaps === 1 ? 'hour' : 'hours'} without a snapshot
          </Text>
        ) : null}
      </Box>
    </Section>
  )
}
