import { Card, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import classes from './entity-card.module.css'

export type EntityCardCell = {
  /** Mono caption, e.g. `RUNNING`. */
  caption: string
  value: string
  unit?: string
  /** Text-sized value, for a reading that is a phrase rather than a figure. */
  small?: boolean
  /** The cell's micro-visual (age bars, a meter). */
  visual?: ReactNode
}

export type EntityCardProps = {
  /** Name line (and an optional muted facts line under it). */
  identity: ReactNode
  /** Right of the identity: a state chip. */
  status: ReactNode
  /** The 2×2 inner panel, row-major. */
  cells: readonly [EntityCardCell, EntityCardCell, EntityCardCell, EntityCardCell]
  /** The closing line: `Now <title>`. */
  now?: ReactNode
}

/**
 * Identity + status line, a 2×2 inner panel of four different micro-readings divided by hairlines,
 * then one `Now …` line (Keel's crew card). Prototype of the SPEC §6.9 entity card.
 */
export function EntityCard({ identity, status, cells, now }: EntityCardProps) {
  return (
    <Card>
      <div className={classes.head}>
        <div className={classes.identity}>{identity}</div>
        {status}
      </div>
      <div className={classes.panel}>
        {cells.map((cell) => (
          <div key={cell.caption} className={classes.cell}>
            <Text className={classes.caption}>{cell.caption}</Text>
            <div className={classes.reading}>
              <span className={cell.small ? classes.valueSmall : classes.value}>{cell.value}</span>
              {cell.unit ? <span className={classes.unit}>{cell.unit}</span> : null}
              {cell.visual ? <span className={classes.visual}>{cell.visual}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {now ? <div className={classes.now}>{now}</div> : null}
    </Card>
  )
}
