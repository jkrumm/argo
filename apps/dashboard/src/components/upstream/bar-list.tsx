/**
 * BarList — a ranked list: label, an inline bar on ONE shared scale, a mono right-aligned value and
 * an optional muted secondary value. Choose it for "top N" (the bar ranks by length before anything
 * is read). Intended for 5–10 rows; past 10 use a table with an inline `Meter` cell. An HTML/CSS
 * primitive, not a chart kind.
 *
 * Colour law: bars are neutral. `accentLeader` (opt-in) lets the top row take the accent — the
 * leader bar, and nothing else. Each value is rendered as text, never only a bar length.
 *
 * @example
 * import { BarList } from 'basalt-ui'
 *
 * // Recovery contributors on a fixed 0–100 scale, the qualitative level as the secondary value:
 * <BarList label="Recovery contributors" max={100} items={[{ label: 'Sleep', value: 82, secondary: 'Good' }]} />
 *
 * <BarList
 *   label="Top projects by tokens"
 *   items={[{ label: 'argo', value: 1840, secondary: '41%' }, { label: 'rb', value: 920 }]}
 *   format={compact}
 *   accentLeader
 * />
 */
import { Box, Skeleton, VisuallyHidden } from '@mantine/core'
import type { ReactNode } from 'react'
import { cx } from './props'
import type { BasaltProps } from './props'
import classes from './bar-list.module.css'
import { asText, barPercent } from './scale'

type BarListItem = { label: string; value: number; secondary?: ReactNode; key?: string }

export type BarListProps = BasaltProps & {
  /** Accessible name of the list. Required. */
  label: string
  /** Rows in display order (sort them yourself; the list does not reorder). */
  items: readonly BarListItem[]
  /** Formats each value. Default: the number as written. */
  format?: (value: number) => string
  /** Scale end shared by every bar. Default: the largest value. */
  max?: number
  /** The first row's bar takes the accent. Off by default. */
  accentLeader?: boolean
  /** Renders row-shaped skeletons. */
  loading?: boolean
  /** Skeleton rows while loading. Default 5. */
  loadingRows?: number
  /** Muted line shown when `items` is empty. */
  emptyText?: string
}

export function BarList({
  label,
  items,
  format = asText,
  max,
  accentLeader = false,
  loading = false,
  loadingRows = 5,
  emptyText = 'No data',
  className,
  style,
}: BarListProps) {
  if (loading) {
    return (
      <div className={cx(classes.root, className)} style={style} aria-busy="true">
        <VisuallyHidden>{`Loading ${label}`}</VisuallyHidden>
        {Array.from({ length: loadingRows }, (_, i) => (
          <Skeleton key={i} className={classes.skeletonRow} data-bar-skeleton />
        ))}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <output className={cx(classes.root, className)} style={style} aria-label={label}>
        <span className={classes.empty}>{emptyText}</span>
      </output>
    )
  }

  const scale =
    max ?? items.reduce((top, i) => (Number.isFinite(i.value) ? Math.max(top, i.value) : top), 0)
  return (
    // The explicit role is deliberate: `list-style: none` makes Safari/VoiceOver drop the implicit one.
    <Box
      component="ul"
      className={cx(classes.root, className)}
      style={style}
      role="list"
      aria-label={label}
    >
      {items.map((item, i) => {
        const isLeader = accentLeader && i === 0
        return (
          <li key={item.key ?? `${item.label}-${i}`} className={classes.row}>
            <Box
              component="span"
              className={cx(classes.bar, isLeader && classes.leader)}
              style={{ width: `${barPercent(item.value, scale)}%` }}
              data-bar-leader={isLeader ? '' : undefined}
              aria-hidden
            />
            <span className={classes.label} title={item.label}>
              {item.label}
            </span>
            <span className={classes.value}>
              {Number.isFinite(item.value) ? format(item.value) : '—'}
            </span>
            {item.secondary !== undefined && (
              <span className={classes.secondary}>{item.secondary}</span>
            )}
          </li>
        )
      })}
    </Box>
  )
}
