import { Text } from '@mantine/core'
import type { ReactNode } from 'react'
import classes from './stat-strip.module.css'

export type StatStripCell = {
  /** Mono caption naming the quantity, e.g. `NEEDS YOU · now`. */
  caption: string
  /** The headline reading. A bare integer must carry a `unit`. */
  value: string
  unit?: string
  /** Status ink for the value (a `VX.status.*` ref). Neutral when omitted. */
  tone?: string
  /** The micro-visual: sparkline, meter or segments. */
  visual?: ReactNode
  /** A muted line under the visual. */
  footer?: ReactNode
}

export type StatStripProps = {
  label: string
  cells: readonly StatStripCell[]
}

/**
 * Joined stat cells divided by 1 px hairlines, one column on a narrow container. Prototype of
 * `StatGroup variant="strip"` (`caption, value, unit, visual`, plus a `footer` line per cell).
 */
export function StatStrip({ label, cells }: StatStripProps) {
  return (
    <section className={classes.root} aria-label={label}>
      <div className={classes.grid}>
        {cells.map((cell) => (
          <div key={cell.caption} className={classes.cell}>
            <Text className={classes.caption}>{cell.caption}</Text>
            <div className={classes.reading}>
              <Text
                component="span"
                className={classes.value}
                {...(cell.tone !== undefined && { c: cell.tone })}
              >
                {cell.value}
              </Text>
              {cell.unit ? <span className={classes.unit}>{cell.unit}</span> : null}
            </div>
            {cell.visual ? <div className={classes.visual}>{cell.visual}</div> : null}
            {cell.footer ? <div className={classes.footer}>{cell.footer}</div> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
