import { BandStrip } from 'basalt-ui/charts'
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { Text } from '@mantine/core'
import type { HistoryPoint } from '../../lib/queries/agents'
import { hourlyWorking, peakWorking, type HourBucket } from '../agents/model'
import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import { axisPosition, dayAxis, meetingState, type Meeting } from './model'
import classes from './home.module.css'

const HISTORY_HOURS = 24
const TICK_EVERY_HOURS = 12

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const BAND_STATES = [
  {
    key: 'working',
    label: 'Working (hourly peak)',
    color: VX.muted,
    formatValue: (d: HourBucket) => `${d.working ?? 0} agents`,
  },
  {
    key: 'quiet',
    label: 'None working',
    color: alpha(VX.muted, 0.15),
    formatValue: () => '0 agents',
  },
  { key: 'gap', label: 'No snapshot', color: alpha(VX.status.warn, 0.35) },
  { key: 'pending', label: 'Hour in progress', color: alpha(VX.muted, 0.08) },
] as const

export function AgentsBand({
  history,
  fleetSize,
  now,
}: {
  history: HistoryPoint[] | undefined
  /** The limit the intensity is read against: every agent working is a full cell. */
  fleetSize: number | null
  now: number
}) {
  const buckets = hourlyWorking(history, HISTORY_HOURS, now)
  const peak = peakWorking(buckets)
  const capacity = fleetSize || peak?.value || 1
  const currentHourMs = buckets.at(-1)?.hourMs
  const getBand = (d: HourBucket): BandSpan => {
    if (d.working === null) return { state: d.hourMs === currentHourMs ? 'pending' : 'gap' }
    if (d.working === 0) return { state: 'quiet' }
    return {
      state: 'working',
      fill: alpha(VX.muted, 0.12 + 0.4 * Math.min(1, d.working / capacity)),
    }
  }
  const ticks = buckets
    .filter((b) => new Date(b.hourMs).getHours() % TICK_EVERY_HOURS === 0)
    .map((b) => b.hourMs)
  if (peak === null)
    return (
      <Text size="xs" c="dimmed">
        No snapshot in the last 24 h
      </Text>
    )
  return (
    <BandStrip
      ariaLabel="Agents working per hour over the last 24 hours"
      data={buckets}
      x={(d) => d.hourMs}
      xTicks={ticks}
      formatX={clock}
      states={BAND_STATES}
      getBand={getBand}
      legend={false}
      height={28}
    />
  )
}

export function DayAxis({
  meetings,
  next,
  now,
}: {
  meetings: readonly Meeting[]
  next: Meeting | null
  now: number
}) {
  const axis = dayAxis(meetings)
  const label = meetings
    .map((m) => `${clock(m.startMs)}, ${formatDurationMin(m.durationMin)}`)
    .join('; ')
  return (
    <div>
      <div
        className={classes.axis}
        role="img"
        aria-label={`Meetings on a ${axis.from}–${axis.to} h day axis: ${label}`}
      >
        <div className={classes.axisTrack} />
        {meetings.map((m) => {
          const cls = [
            classes.tick,
            m === next ? classes.tickNext : '',
            meetingState(m, now) === 'past' ? classes.tickPast : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <span
              key={m.key}
              className={cls}
              style={{ left: `${axisPosition(m.startMs, axis) * 100}%` }}
            />
          )
        })}
        <span className={classes.nowMark} style={{ left: `${axisPosition(now, axis) * 100}%` }} />
      </div>
      <div className={classes.axisLabels}>
        <span>{String(axis.from).padStart(2, '0')}</span>
        <span>dot now · bars starts</span>
        <span>{String(axis.to).padStart(2, '0')}</span>
      </div>
    </div>
  )
}
