import type { ReactNode } from 'react'
import { Meter, StatGroup, useSizeClass, type StatStripCell } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import {
  NO_PACE_REASON,
  paceRange,
  ratingShape,
  ratingsFooter,
  shelfParts,
  type Pace,
  type ShelfItem,
  type ShelfCounts,
} from './model'
import { NBSP } from '../../lib/format'
import classes from './reading.module.css'

/** A split is not a verdict: the stepped neutral ramp, never a status colour. */
const SEGMENT_FILLS = [0.75, 0.5, 0.25, 0.15, 0.1].map((a) => alpha(VX.muted, a))

const fillAt = (i: number): string => SEGMENT_FILLS[Math.min(i, SEGMENT_FILLS.length - 1)] as string

function shelfCell(counts: ShelfCounts, footer: string | null): StatStripCell {
  const parts = shelfParts(counts)
  return {
    key: 'shelf',
    caption: 'Shelf · by status',
    value: String(counts.total),
    unit: counts.total === 1 ? 'book' : 'books',
    visual: (
      <Meter
        label="Books by shelf status"
        max={counts.total}
        startCaption={null}
        segments={parts.map((p, i) => ({ label: p.label, value: p.value, color: fillAt(i) }))}
      />
    ),
    ...(footer === null ? {} : { footer }),
  }
}

/** The axis is mono, whose face has no good `★`: the glyph renders in the body face. */
function withBodyStar(text: string): ReactNode {
  const [head, ...rest] = text.split('★')
  if (rest.length === 0) return text
  return (
    <>
      {head}
      <span className={classes.star}>★</span>
      {rest.join('★')}
    </>
  )
}

function ratingsCell(shelf: readonly ShelfItem[], narrow: boolean): StatStripCell {
  const shape = ratingShape(shelf)
  if (shape.mean === null) {
    return { key: 'ratings', caption: 'Ratings · 0 rated', value: null, footer: 'no rated books' }
  }
  const footer = ratingsFooter(shape)
  const peak = Math.max(...shape.buckets)
  // Bucket i holds [i, i + 1), so the track spans 1…6 and a mean of m lands at (m − 1) / 5.
  const meanAt = Math.min(100, Math.max(0, ((shape.mean - 1) / 5) * 100))
  return {
    key: 'ratings',
    caption: `Ratings (★) · ${shape.n} rated`,
    value: shape.mean.toFixed(1),
    unit: `★${NBSP}mean`,
    visual: (
      <div
        role="img"
        aria-label={`Rated books per star: ${shape.labels.map((l, i) => `${l.aria}: ${shape.buckets[i]}`).join(', ')}; mean ${shape.mean.toFixed(1)} ★`}
      >
        <div className={classes.histogram}>
          {shape.buckets.map((count, i) => (
            <div key={i} className={classes.bucket}>
              <div
                className={count > 0 ? `${classes.bar} ${classes.barFilled}` : classes.bar}
                style={{ height: `${peak === 0 ? 0 : (count / peak) * 100}%` }}
              />
            </div>
          ))}
          <div className={classes.meanTick} style={{ left: `${meanAt}%` }} />
        </div>
        <div className={classes.axis}>
          {shape.labels.map((label, i) => (
            <span key={i} className={classes.axisLabel}>
              <span title={label.aria}>{withBodyStar(narrow ? label.compact : label.visible)}</span>
              <span>{shape.buckets[i]}</span>
            </span>
          ))}
        </div>
      </div>
    ),
    ...(footer === undefined ? {} : { footer }),
  }
}

function paceCell(pace: Pace): StatStripCell {
  if (pace.median === null || pace.median <= 0) {
    return { key: 'pace', caption: 'Reading pace', value: null, footer: NO_PACE_REASON }
  }
  return {
    key: 'pace',
    caption: `Pace · median of ${pace.paces.length} ${pace.paces.length === 1 ? 'book' : 'books'}`,
    value: String(pace.median),
    unit: 'pages/h',
    footer: paceRange(pace.paces) ?? 'one book has reading time so far',
  }
}

export function ReadingStrip({
  counts,
  shelf,
  pace,
  footer,
}: {
  counts: ShelfCounts
  shelf: readonly ShelfItem[]
  pace: Pace
  footer: string | null
}) {
  const narrow = useSizeClass() === 'compact'
  return (
    <StatGroup
      variant="strip"
      label="Reading summary"
      cols={3}
      cells={[shelfCell(counts, footer), ratingsCell(shelf, narrow), paceCell(pace)]}
    />
  )
}
