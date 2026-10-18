import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import {
  NO_PACE_REASON,
  ratingShape,
  ratingsFooter,
  shelfParts,
  shelfShares,
  totalReadSeconds,
  type Pace,
  type ShelfItem,
  type ShelfCounts,
} from './model'
import { formatReadTime } from './format'
import classes from './reading.module.css'

/** A split is not a verdict: the stepped neutral ramp, never a status colour. */
const SEGMENT_FILLS = [0.75, 0.5, 0.25, 0.15, 0.1].map((a) => alpha(VX.muted, a))

const fillAt = (i: number): string => SEGMENT_FILLS[Math.min(i, SEGMENT_FILLS.length - 1)] as string

function shelfCell(counts: ShelfCounts): StatStripCell {
  const parts = shelfParts(counts)
  const shares = shelfShares(counts)
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
    ...(shares === null
      ? {}
      : { footer: `${shares.read}% of the shelf is read · ${shares.backlog}% is backlog` }),
  }
}

function ratingsCell(shelf: readonly ShelfItem[]): StatStripCell {
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
    caption: `Ratings · ${shape.n} rated`,
    value: shape.mean.toFixed(1),
    unit: '★ mean',
    visual: (
      <div
        className={classes.ratingsCell}
        role="img"
        aria-label={`Rated books per star: ${shape.buckets.map((c, i) => `${i + 1} ★ ${c}`).join(', ')}; mean ${shape.mean.toFixed(1)} ★`}
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
          {shape.buckets.map((count, i) => (
            <span key={i} className={i % 2 === 1 ? classes.axisMinor : undefined}>
              {i + 1}★ {count}
            </span>
          ))}
        </div>
      </div>
    ),
    ...(footer === undefined ? {} : { footer }),
  }
}

function paceCell(pace: Pace, shelf: readonly ShelfItem[]): StatStripCell {
  if (pace.median === null || pace.median <= 0) {
    return { key: 'pace', caption: 'Reading pace', value: null, footer: NO_PACE_REASON }
  }
  const top = Math.max(...pace.paces) * 1.15
  const at = (v: number) => `${(v / top) * 100}%`
  const seconds = totalReadSeconds(shelf)
  return {
    key: 'pace',
    caption: `Reading pace · median of ${pace.paces.length} ${pace.paces.length === 1 ? 'book' : 'books'}`,
    value: String(pace.median),
    unit: 'pages/h',
    visual: (
      <div
        role="img"
        aria-label={`Pace per book in pages per hour: ${pace.paces.join(', ')}; median ${pace.median}`}
      >
        <div className={classes.paceTrack}>
          <div className={classes.paceRail} />
          {pace.paces.map((p, i) => (
            <span key={i} className={classes.paceDot} style={{ left: at(p) }} />
          ))}
          <span className={classes.paceMedian} style={{ left: at(pace.median) }} />
        </div>
        <div className={classes.paceAxis}>
          <span>0</span>
          <span>{Math.round(top)} pages/h</span>
        </div>
      </div>
    ),
    footer: `${formatReadTime(seconds)} read across in-progress and finished books`,
  }
}

export function ReadingStrip({
  counts,
  shelf,
  pace,
}: {
  counts: ShelfCounts
  shelf: readonly ShelfItem[]
  pace: Pace
}) {
  return (
    <StatGroup
      variant="strip"
      label="Reading summary"
      cols={3}
      cells={[shelfCell(counts), ratingsCell(shelf), paceCell(pace, shelf)]}
    />
  )
}
