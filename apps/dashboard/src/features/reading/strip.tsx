import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { Bars } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import {
  NO_PACE_REASON,
  paceBars,
  paceLabel,
  paceRange,
  gapsBeforePosition,
  RATING_MAX,
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

/** A track position as CSS: `at` column widths plus the gaps left of it, on the histogram's own grid. */
const trackLeft = (at: number): string =>
  `calc((100% - ${RATING_MAX - 1} * var(--vx-space-control-gap)) / ${RATING_MAX} * ${at} + ${gapsBeforePosition(at)} * var(--vx-space-control-gap))`

function ratingsCell(shelf: readonly ShelfItem[]): StatStripCell {
  const shape = ratingShape(shelf)
  if (shape.mean === null || shape.meanAt === null) {
    return { key: 'ratings', caption: 'Ratings · 0 rated', value: null, footer: 'no rated books' }
  }
  const footer = ratingsFooter(shape)
  const peak = Math.max(...shape.buckets)
  return {
    key: 'ratings',
    caption: `Ratings (★) · ${shape.n} rated`,
    value: shape.mean.toFixed(1),
    unit: `★${NBSP}mean`,
    visual: (
      <div
        role="img"
        aria-label={`Rated books per star column: ${shape.spans.map((span, i) => `${shape.labels[i]} ★ (${span}): ${shape.buckets[i]}`).join(', ')}; mean ${shape.mean.toFixed(1)} ★`}
      >
        <div className={classes.histogram}>
          {shape.buckets.map((count, i) => {
            const share = peak === 0 ? 0 : count / peak
            return (
              <div
                key={i}
                className={classes.bucket}
                title={`${shape.labels[i]} ★: ${shape.spans[i]}`}
              >
                {count > 0 && <span className={classes.count}>{count}</span>}
                <div
                  className={count > 0 ? `${classes.bar} ${classes.barFilled}` : classes.bar}
                  // a percent of the bar zone (grid row 2), not of the column
                  style={{ height: `${share * 100}%` }}
                />
              </div>
            )
          })}
          <div className={classes.meanTick} style={{ left: trackLeft(shape.meanAt) }} />
        </div>
        <div className={classes.axis} aria-hidden>
          {shape.labels.map((label) => (
            <span key={label}>{label}</span>
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
  const books = `${pace.books.length} ${pace.books.length === 1 ? 'book' : 'books'}`
  const bars = paceBars(pace.books)
  return {
    key: 'pace',
    caption: `Pace · median of ${books}`,
    value: String(pace.median),
    unit: 'pages/h',
    ...(bars.length === 0
      ? {}
      : {
          visual: (
            <Bars
              ariaLabel={`Reading pace per book, slowest to fastest: ${bars.map((b) => paceLabel(b.pace)).join(', ')}`}
              data={bars}
              height={28}
              x={(d) => d.book}
              formatX={(i) => bars.find((b) => b.book === i)?.label ?? ''}
              bars={[
                {
                  key: 'pace',
                  label: 'Pace',
                  color: alpha(VX.muted, 0.35),
                  getValue: (d) => d.pace,
                  formatValue: (v) => paceLabel(Math.round(v)),
                },
              ]}
              legend={false}
            />
          ),
        }),
    footer: paceRange(pace.books) ?? 'one book has reading time so far',
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
  return (
    <StatGroup
      variant="strip"
      label="Reading summary"
      cols={3}
      shotAbsent={['empty']}
      cells={[shelfCell(counts, footer), ratingsCell(shelf), paceCell(pace)]}
    />
  )
}
