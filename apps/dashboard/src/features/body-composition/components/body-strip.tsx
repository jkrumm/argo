/**
 * Local prototype of basalt-ui's `StatGroup variant="strip"` plus the multi-row cell
 * (docs/design/UPSTREAM.md): one joined surface of cells, each `caption · qualifier` on one mono
 * line, a hero value with a muted unit, a micro-visual and a mono footer. No coloured edge.
 */
import type { ReactNode } from 'react'
import { Box } from '@mantine/core'
import classes from './body-strip.module.css'

export function Strip({ children }: { children: ReactNode }) {
  return (
    <Box className={classes.frame}>
      <Box className={classes.strip}>{children}</Box>
    </Box>
  )
}

export function StripCell({
  caption,
  qualifier,
  value,
  unit,
  heroExtra,
  children,
  footer,
  shot,
}: {
  caption: string
  qualifier?: string
  /** The hero value, already formatted (`—` for unknown). */
  value: string
  unit?: string
  /** Sits on the hero baseline after the unit: a delta or a pill. */
  heroExtra?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  shot?: string
}) {
  return (
    <Box className={classes.cell} data-shot={shot}>
      <Box className={classes.caption}>
        <span>{caption}</span>
        {qualifier !== undefined && <span className={classes.qualifier}>· {qualifier}</span>}
      </Box>
      <Box className={classes.hero}>
        <span className={classes.value}>{value}</span>
        {unit !== undefined && <span className={classes.unit}>{unit}</span>}
        {heroExtra}
      </Box>
      {children}
      {footer !== undefined && <Box className={classes.footer}>{footer}</Box>}
    </Box>
  )
}

/** One sparkline row of a cell: label · sparkline · value · delta. */
export function SiteLine({
  label,
  value,
  sparkline,
  delta,
}: {
  label: string
  value: string
  sparkline: ReactNode
  delta: ReactNode
}) {
  return (
    <Box className={classes.siteRow}>
      <span className={classes.rowLabel}>{label}</span>
      <Box className={classes.rowSpark}>{sparkline}</Box>
      <span className={classes.rowValue}>{value}</span>
      <span className={classes.rowDelta}>{delta}</span>
    </Box>
  )
}

/** The one-row empty state that replaces an empty chart or cell (a `compact` EmptyState). */
export function EmptyRow({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <Box className={classes.emptyRow} data-shot="empty-row">
      <span>{text}</span>
      {action}
    </Box>
  )
}
