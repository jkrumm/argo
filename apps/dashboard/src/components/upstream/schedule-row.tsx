import { formatMinutes } from '../../lib/format'
/**
 * ScheduleRow — one agenda line: clock time with its duration under it, a proportional title,
 * a muted meta line, an optional pill for the next item and an optional trailing action (a
 * `Join` link). Generic on purpose: no domain types in the props, so Calendar and the Home Today
 * list render the same row.
 *
 * Prototype of Keel's `schedule-item` (docs/design/UPSTREAM.md).
 */
import type { ReactNode } from 'react'
import classes from './schedule-row.module.css'

export type ScheduleRowProps = {
  /** The start, already formatted (`09:30`). */
  start: string
  durationMin: number
  title: string
  /** Muted second line (source · attendees). */
  meta?: ReactNode
  /** A short chip after the title, e.g. `in 12m`, on the next item only. */
  pill?: ReactNode
  /** Trailing action, e.g. a `Join` icon-link. */
  action?: ReactNode
  /** Dims a row that already ended. */
  past?: boolean
  /** Title lines before the ellipsis. Default 1; a surface with room for a long title opts into 2. */
  titleLines?: 1 | 2
}

export function ScheduleRow({
  start,
  durationMin,
  title,
  meta,
  pill,
  action,
  past = false,
  titleLines = 1,
}: ScheduleRowProps) {
  const metaTitle = typeof meta === 'string' ? meta : undefined
  return (
    <div role="listitem" className={`${classes.row}${past ? ` ${classes.past}` : ''}`}>
      <div className={classes.inner}>
        <div className={classes.time}>
          <span>{start}</span>
          <span className={classes.duration}>{formatMinutes(durationMin)}</span>
        </div>
        <div className={classes.body}>
          <div
            className={`${classes.title}${titleLines === 2 ? ` ${classes.titleTwoLines}` : ''}`}
            title={title}
          >
            {title}
          </div>
          {meta !== undefined && meta !== null && (
            <div className={classes.meta} title={metaTitle}>
              {meta}
            </div>
          )}
        </div>
        {(pill !== undefined || action !== undefined) && (
          <div className={classes.trailing}>
            {pill !== undefined && <span className={classes.pill}>{pill}</span>}
            {action}
          </div>
        )}
      </div>
    </div>
  )
}
