import type { CSSProperties } from 'react'
import { Box, Card } from '@mantine/core'
import { fmtShortDay, nightNote, verdictTone } from '../formulas'
import type { Night } from '../types'
import classes from './night-strip.module.css'

/**
 * One cell per night: date, a verdict band, then ONE fact line — the window length when there is
 * one, else the first killer's short label, so an all-out week still says why per night. The best
 * (or, when all are out, closest) night carries a marker. Scrolls with snap below the regular
 * container class.
 */
export function NightStrip({
  nights,
  selectedDate,
  markedDate,
  onSelect,
}: {
  nights: Night[]
  selectedDate: string
  /** The night the verdict is about. */
  markedDate: string | null
  onSelect: (date: string) => void
}) {
  const allOut = nights.every((n) => n.verdict === 'out')
  return (
    <Card data-shot="night-strip">
      <Box className={classes.host}>
        <Box
          className={classes.scroller}
          role="group"
          aria-label="Nights"
          style={{ '--night-count': nights.length } as CSSProperties}
        >
          {nights.map((night) => {
            const out = night.verdict === 'out'
            return (
              <button
                key={night.date}
                type="button"
                className={classes.cell}
                aria-pressed={night.date === selectedDate}
                onClick={() => onSelect(night.date)}
              >
                <span className={classes.date}>{fmtShortDay(night.date)}</span>
                <Box
                  component="span"
                  className={classes.band}
                  bg={verdictTone(night.verdict)}
                  opacity={out ? 0.5 : 1}
                />
                <span className={classes.note}>{nightNote(night)}</span>
                <span className={classes.marker}>
                  {night.date === markedDate ? (allOut ? 'CLOSEST' : 'BEST') : ''}
                </span>
              </button>
            )
          })}
        </Box>
      </Box>
    </Card>
  )
}
