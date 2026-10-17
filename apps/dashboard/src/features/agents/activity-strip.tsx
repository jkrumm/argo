import { useMemo } from 'react'
import { Section } from 'basalt-ui'
import { BandStrip } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { BandSpan } from 'basalt-ui/charts'
import type { HistoryPoint } from '../../lib/queries/agents'
import { hourlyWorking, type HourBucket } from './model'

type Props = {
  history: HistoryPoint[] | undefined
  hours: number
  now: number
}

const SIX_HOURS = 6

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const STATES = [
  {
    key: 'working',
    label: 'Agents working',
    color: VX.line,
    formatValue: (d: HourBucket) => `${d.working ?? 0} working (peak in the hour)`,
  },
  {
    key: 'quiet',
    label: 'None working',
    color: alpha(VX.line, 0.1),
    formatValue: () => '0 working',
  },
  { key: 'gap', label: 'No snapshot', color: alpha(VX.status.warn, 0.35) },
] as const

/**
 * Agents working per hour over the window: one cell per hour, intensity = the hour's peak working
 * count, a distinct flat cell where no snapshot landed (a feed stall shows as a hole, not a zero).
 */
export function ActivityStrip({ history, hours, now }: Props) {
  const buckets = useMemo(() => hourlyWorking(history, hours, now), [history, hours, now])
  const peak = buckets.reduce((top, b) => Math.max(top, b.working ?? 0), 0)

  const getBand = useMemo(
    () =>
      (d: HourBucket): BandSpan => {
        if (d.working === null) return { state: 'gap' }
        if (d.working === 0) return { state: 'quiet' }
        return { state: 'working', fill: alpha(VX.line, 0.25 + 0.75 * (d.working / peak)) }
      },
    [peak],
  )
  const ticks = buckets
    .filter((b) => new Date(b.hourMs).getHours() % SIX_HOURS === 0)
    .map((b) => b.hourMs)

  return (
    <Section title="Last 24 h · agents working per hour" value={String(peak)} unit="agents at peak">
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
    </Section>
  )
}
