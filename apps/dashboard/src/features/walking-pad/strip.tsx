import type { ReactNode } from 'react'
import { Box, Skeleton } from '@mantine/core'
import classes from './strip.module.css'

export function Strip({ children }: { children: ReactNode }) {
  return (
    <Box className={classes.frame}>
      <Box className={classes.strip}>{children}</Box>
    </Box>
  )
}

export type StripCellProps = {
  /** Mono caption, rendered uppercase, e.g. "This week". */
  caption: string
  /** Muted qualifier on the caption line, e.g. "Mon–Sun". */
  qualifier?: string
  /** A control pinned to the caption line. */
  action?: ReactNode
  /** The hero value, already formatted (`—` for an unknown reading). */
  value: string
  unit?: string
  /** The comparison line under the hero: a delta with its period. */
  delta?: ReactNode
  /** The cell's micro-visual(s). */
  children?: ReactNode
  footer?: string
  /** Names the cell for `basalt-ui shot`. */
  shot?: string
  loading?: boolean
}

export function StripCell({
  caption,
  qualifier,
  action,
  value,
  unit,
  delta,
  children,
  footer,
  shot,
  loading = false,
}: StripCellProps) {
  return (
    <Box className={classes.cell} data-shot={shot}>
      <Box className={classes.caption}>
        <span>{caption}</span>
        {qualifier !== undefined && <span className={classes.qualifier}>· {qualifier}</span>}
        {action}
      </Box>
      {loading ? (
        <Skeleton height={32} width={96} radius="sm" />
      ) : (
        <Box className={classes.hero}>
          <span className={classes.value}>{value}</span>
          {unit !== undefined && <span className={classes.unit}>{unit}</span>}
        </Box>
      )}
      {delta !== undefined && <Box className={classes.delta}>{delta}</Box>}
      {children}
      {footer !== undefined && <Box className={classes.footer}>{footer}</Box>}
    </Box>
  )
}
