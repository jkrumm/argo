import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Box, Card } from '@mantine/core'
import { OFFSCREEN_TOLERANCE_PX } from '../constants'
import {
  countOffscreen,
  fmtShortDay,
  longestWindow,
  moreNightsLabel,
  nightNote,
  shortfallScale,
  shortfallShare,
  verdictTone,
  windowShare,
} from '../formulas'
import type { Night } from '../types'
import classes from './night-strip.module.css'

/** A night's bar: the window length on a usable night, the core-gate shortfall on a night out on it,
 * both on one scale shared by the strip. A night with nothing to rank keeps the bar's height empty. */
function NightBar({ night, scale, longest }: { night: Night; scale: number; longest: number }) {
  if (night.verdict !== 'out') {
    const share = windowShare(night, longest)
    if (share === null) return <span className={classes.band} />
    return (
      <span className={classes.track}>
        <Box
          component="span"
          className={classes.fill}
          bg={verdictTone(night.verdict)}
          w={`${share * 100}%`}
        />
      </span>
    )
  }
  const share = shortfallShare(night, scale)
  if (share === null) return <span className={classes.band} />
  return (
    <span className={classes.track}>
      <Box
        component="span"
        className={classes.fill}
        bg={verdictTone('out')}
        w={`${share * 100}%`}
      />
    </span>
  )
}

/**
 * One cell per night: date, a bar, then ONE fact line — the window length when there is
 * one, else the first killer's short label, so an all-out week still says why per night. The bar is
 * the window length on a usable night (verdict hue) and, on a night out on the core gate, its shortfall;
 * each on a scale shared by every cell (longer = more window / further from passing); other ruled-out
 * nights draw none. The best (or,
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
  const longest = longestWindow(nights)
  const scroller = useRef<HTMLDivElement>(null)
  const [offscreenCount, setOffscreenCount] = useState(0)
  const measure = useCallback(() => {
    const el = scroller.current
    if (el === null) return
    const rights = Array.from(el.children)
      .filter((c): c is HTMLElement => c instanceof HTMLElement)
      .map((c) => c.getBoundingClientRect().right)
    setOffscreenCount(
      countOffscreen(rights, el.getBoundingClientRect().right, OFFSCREEN_TOLERANCE_PX),
    )
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
      <Box className={classes.host} data-more={offscreenCount > 0}>
        <Box
          ref={scroller}
          onScroll={measure}
          className={classes.scroller}
          role="group"
          aria-label={
            offscreenCount > 0
              ? `Nights, ${moreNightsLabel(offscreenCount).replace(' →', '')} off-screen`
              : 'Nights'
          }
          style={{ '--night-count': nights.length } as CSSProperties}
        >
          {nights.map((night) => {
            return (
              <button
                key={night.date}
                type="button"
                className={classes.cell}
                aria-pressed={night.date === selectedDate}
                onClick={() => onSelect(night.date)}
              >
                <span className={classes.date}>{fmtShortDay(night.date)}</span>
                <NightBar night={night} scale={scale} longest={longest} />
                <span className={classes.note}>{nightNote(night)}</span>
                <span className={classes.marker}>
                  {night.date === markedDate ? (allOut ? 'CLOSEST' : 'BEST') : ''}
                </span>
              </button>
            )
          })}
        </Box>
        <span className={classes.more}>{moreNightsLabel(offscreenCount)}</span>
      </Box>
    </Card>
  )
}
