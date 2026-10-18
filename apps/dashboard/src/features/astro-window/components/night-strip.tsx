import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Box, Card } from '@mantine/core'
import { fmtShortDay, nightNote, shortfallScale, shortfallShare, verdictTone } from '../formulas'
import type { Night } from '../types'
import classes from './night-strip.module.css'

/**
 * One cell per night: date, a bar, then ONE fact line — the window length when there is
 * one, else the first killer's short label, so an all-out week still says why per night. The bar is
 * the verdict colour on a usable night and, on a night out on the core gate, its shortfall on a scale
 * shared by every cell (longer = further from passing); other ruled-out nights draw none. The best (or,
 * when all are out, closest) night carries a marker. Below the regular container class the strip
 * scrolls with snap and counts the nights still off-screen.
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
  const scale = shortfallScale(nights)
  const scroller = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(0)
  const measure = useCallback(() => {
    const el = scroller.current
    if (el === null) return
    const edge = el.scrollLeft + el.clientWidth
    const cells = Array.from(el.children) as HTMLElement[]
    setHidden(cells.filter((c) => c.offsetLeft + c.offsetWidth > edge + 1).length)
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, nights.length])
  return (
    <Card data-shot="night-strip">
      <Box className={classes.host} data-more={hidden > 0}>
        <Box
          ref={scroller}
          onScroll={measure}
          className={classes.scroller}
          role="group"
          aria-label="Nights"
          style={{ '--night-count': nights.length } as CSSProperties}
        >
          {nights.map((night) => {
            const share = shortfallShare(night, scale)
            return (
              <button
                key={night.date}
                type="button"
                className={classes.cell}
                aria-pressed={night.date === selectedDate}
                onClick={() => onSelect(night.date)}
              >
                <span className={classes.date}>{fmtShortDay(night.date)}</span>
                {night.verdict !== 'out' ? (
                  <Box component="span" className={classes.band} bg={verdictTone(night.verdict)} />
                ) : share !== null ? (
                  <span className={classes.track}>
                    <Box component="span" className={classes.fill} w={`${share * 100}%`} />
                  </span>
                ) : (
                  <span className={classes.band} />
                )}
                <span className={classes.note}>{nightNote(night)}</span>
                <span className={classes.marker}>
                  {night.date === markedDate ? (allOut ? 'CLOSEST' : 'BEST') : ''}
                </span>
              </button>
            )
          })}
        </Box>
        <span className={classes.more}>{hidden > 0 ? `${hidden} more nights →` : ''}</span>
      </Box>
    </Card>
  )
}
