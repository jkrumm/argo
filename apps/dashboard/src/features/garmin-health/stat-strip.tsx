/**
 * Prototype of basalt-ui's `StatGroup variant="strip"` (docs/design/UPSTREAM.md): one joined surface of
 * cells divided by 1px hairlines. Each cell is `caption · qualifier` on one mono line, a hero value
 * with a muted unit, a micro-visual and an optional footer. No coloured edge, ever.
 */
import type { ReactNode } from 'react'
import { Box, Skeleton } from '@mantine/core'
import classes from './stat-strip.module.css'

export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <Box className={classes.frame}>
      <Box className={classes.strip}>{children}</Box>
    </Box>
  )
}

export type StripCellProps = {
  /** Mono caption, e.g. "Recovery". Rendered uppercase. */
  caption: string
  /** Muted qualifier on the same line, e.g. "today". Not uppercased. */
  qualifier?: string
  /** The hero value, already formatted (`—` for a null reading). */
  value: string
  /** Muted unit after the value. */
  unit?: string
  /** The cell's micro-visual(s). */
  children?: ReactNode
  /** Mono footer pinned to the cell's foot. */
  footer?: string
  /** Names the cell for `basalt-ui shot` (`data-shot`). */
  shot?: string
  /** Dims the cell while a refetch shows the previous window's data. */
  stale?: boolean
  /** Swaps the hero for a skeleton while the cell's data is in flight. */
  loading?: boolean
}

export function StripCell({
  caption,
  qualifier,
  value,
  unit,
  children,
  footer,
  loading = false,
  shot,
  stale = false,
}: StripCellProps) {
  return (
    <Box className={classes.cell} data-shot={shot} opacity={stale ? 0.55 : 1}>
      <Box className={classes.caption}>
        <span>{caption}</span>
        {qualifier !== undefined && <span className={classes.qualifier}>· {qualifier}</span>}
      </Box>
      {loading ? (
        <Skeleton height={32} width={96} radius="sm" />
      ) : (
        <Box className={classes.hero}>
          <span className={classes.value}>{value}</span>
          {unit !== undefined && <span className={classes.unit}>{unit}</span>}
        </Box>
      )}
      {children}
      {footer !== undefined && <Box className={classes.footer}>{footer}</Box>}
    </Box>
  )
}

export type SignalRowProps = {
  label: string
  /** Current reading with its unit, e.g. "52 bpm". */
  value: string
  sparkline: ReactNode
  /** Signed delta (a `DeltaBadge`), or `null` when the signal has none. */
  delta: ReactNode
}

/** One sparkline row of a strip cell: label · sparkline · value · delta. */
export function SignalRow({ label, value, sparkline, delta }: SignalRowProps) {
  return (
    <Box className={classes.fitnessRow}>
      <span className={classes.rowLabel}>{label}</span>
      <Box className={classes.rowSpark}>{sparkline}</Box>
      <span className={classes.rowValue}>{value}</span>
      <span className={classes.rowDelta}>{delta}</span>
    </Box>
  )
}
