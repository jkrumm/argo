import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import { clockOf } from '../agents/model'
import { axisPosition, dayAxis, meetingState, type Meeting } from './model'
import classes from './home.module.css'

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
    .map((m) => `${clockOf(m.startMs)}, ${formatDurationMin(m.durationMin)}`)
    .join('; ')
  return (
    <div>
      <div
        className={classes.axis}
        role="img"
        aria-label={`Meeting starts and the current time on a ${axis.from}–${axis.to} h day axis: ${label}`}
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
        <span>{String(axis.to).padStart(2, '0')}</span>
      </div>
    </div>
  )
}
