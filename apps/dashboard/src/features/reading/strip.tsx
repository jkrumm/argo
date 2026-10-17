import { Meter } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Box, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import {
  NO_PACE_REASON,
  ratingShape,
  shelfParts,
  totalReadSeconds,
  type Pace,
  type ShelfItem,
  type ShelfCounts,
} from './model'
import { formatReadTime } from './format'
import classes from './reading.module.css'

const EM_DASH = '—'
/** A split is not a verdict: the stepped neutral ramp, never a status colour. */
const SEGMENT_FILLS = [0.75, 0.5, 0.25, 0.15, 0.1].map((a) => alpha(VX.muted, a))

const fillAt = (i: number): string => SEGMENT_FILLS[Math.min(i, SEGMENT_FILLS.length - 1)] as string

type CellProps = {
  caption: string
  value: string
  unit?: string
  visual?: ReactNode
  footer?: ReactNode
  shot: string
}

function Cell({ caption, value, unit, visual, footer, shot }: CellProps) {
  return (
    <div className={classes.cell} data-shot={`strip-${shot}`}>
      <Text className={classes.caption}>{caption}</Text>
      <div className={classes.reading}>
        <Text component="span" className={classes.value}>
          {value}
        </Text>
        {unit ? <span className={classes.unit}>{unit}</span> : null}
      </div>
      {visual}
      {footer ? <div className={classes.footer}>{footer}</div> : null}
    </div>
  )
}

function ShelfCell({ counts }: { counts: ShelfCounts }) {
  const parts = shelfParts(counts)
  return (
    <Cell
      shot="shelf"
      caption="Shelf · by status"
      value={String(counts.total)}
      unit={counts.total === 1 ? 'book' : 'books'}
      visual={
        <>
          <Meter
            label="Books by shelf status"
            max={counts.total}
            startCaption={null}
            endCaption={null}
            segments={parts.map((p, i) => ({
              label: p.label,
              value: p.value,
              color: fillAt(i),
            }))}
          />
          <div className={classes.legend}>
            {parts.map((p, i) => (
              <span key={p.label} className={classes.legendItem}>
                <Box className={classes.swatch} bg={fillAt(i)} />
                {p.label} <span className={classes.legendValue}>{p.value}</span>
              </span>
            ))}
          </div>
        </>
      }
    />
  )
}

function RatingsCell({ shelf }: { shelf: readonly ShelfItem[] }) {
  const shape = ratingShape(shelf)
  if (shape.mean === null) {
    return (
      <Cell shot="ratings" caption="Ratings · 0 rated" value={EM_DASH} footer="no rated books" />
    )
  }
  const peak = Math.max(...shape.buckets)
  // A bucket's centre sits at (i − ½) / 5 of the track, so a mean of m lands at (m − ½) / 5.
  const meanAt = Math.min(100, Math.max(0, ((shape.mean - 0.5) / 5) * 100))
  return (
    <Cell
      shot="ratings"
      caption={`Ratings · ${shape.n} rated`}
      value={shape.mean.toFixed(1)}
      unit="★ mean"
      visual={
        <div
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
              <span key={i}>
                {i + 1}★ {count}
              </span>
            ))}
          </div>
        </div>
      }
      footer={
        shape.community === null
          ? undefined
          : `community mean ${shape.community.mean.toFixed(1)} ★ on ${shape.community.n} of the same books`
      }
    />
  )
}

function PaceCell({ pace, shelf }: { pace: Pace; shelf: readonly ShelfItem[] }) {
  if (pace.median === null || pace.median <= 0) {
    return <Cell shot="pace" caption="Reading pace" value={EM_DASH} footer={NO_PACE_REASON} />
  }
  const top = Math.max(...pace.paces) * 1.15
  const at = (v: number) => `${(v / top) * 100}%`
  const seconds = totalReadSeconds(shelf)
  return (
    <Cell
      shot="pace"
      caption={`Reading pace · median of ${pace.paces.length} ${pace.paces.length === 1 ? 'book' : 'books'}`}
      value={String(pace.median)}
      unit="pages/h"
      visual={
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
      }
      footer={`${formatReadTime(seconds)} read across in-progress and finished books · one dot per book, tick is the median`}
    />
  )
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
    <section className={classes.strip} aria-label="Reading summary">
      <ShelfCell counts={counts} />
      <RatingsCell shelf={shelf} />
      <PaceCell pace={pace} shelf={shelf} />
    </section>
  )
}
