import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Box, Card } from '@mantine/core'
import { OFFSCREEN_TOLERANCE_PX } from '../constants'
import {
  countOffscreen,
  fmtShortDay,
  longestWindow,
  offscreenNightsText,
  nightNote,
  gateBarScale,
  nightBar,
  verdictTone,
} from '../formulas'
import type { Night } from '../types'
import classes from './night-strip.module.css'

/**
 * A night's bar, from `nightBar`: a usable night's window length, or a night out on the core gate's
 * altitude with a tick at its gate. A night with nothing to rank keeps the bar's height empty.
 */
function NightBar({
  night,
  gateScale,
  longest,
}: {
  night: Night
  gateScale: number
  longest: number
}) {
  const bar = nightBar(night, { gateScale, longest })
  if (bar === null) return <span className={classes.band} />
  return (
    <span className={classes.track}>
      <Box
        component="span"
        className={classes.fill}
        bg={verdictTone(night.verdict)}
        w={`${bar.fill * 100}%`}
      />
      {bar.gate !== null && (
        <span className={classes.gateTick} style={{ insetInlineStart: `${bar.gate * 100}%` }} />
      )}
    </span>
  )
}

/**
 * One cell per night: date, a bar, then ONE fact line — the window length when there is one, else
 * the first killer's short label, so an all-out week still says why per night. The bar is the window
 * length on a usable night (verdict hue); on a night out on the core gate it is the core's altitude
 * against a tick at the gate, so the gap between fill and tick is the miss. Each uses a scale shared
 * by every cell; other ruled-out nights draw none. The best (or, when all are out, closest) night
 * carries a marker. Below the regular container class the strip scrolls with snap and counts the
 * nights still off-screen.
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
  const gateScale = gateBarScale(nights)
  const longest = longestWindow(nights)
  const scroller = useRef<HTMLDivElement>(null)
  const [offscreenCount, setOffscreenCount] = useState(0)
  const frame = useRef(0)
  const measureNow = useCallback(() => {
    const el = scroller.current
    if (el === null) return
    const rights = Array.from(el.children)
      .filter((c): c is HTMLElement => c instanceof HTMLElement)
      .map((c) => c.getBoundingClientRect().right)
    setOffscreenCount(
      countOffscreen(rights, el.getBoundingClientRect().right, OFFSCREEN_TOLERANCE_PX),
    )
  }, [])
  // Scroll fires per frame at worst; one measure per animation frame is plenty.
  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measureNow)
  }, [measureNow])
  useEffect(() => {
    const el = scroller.current
    if (el === null) return
    measureNow()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [measure, measureNow, nights])
  const offscreenText = offscreenNightsText(offscreenCount)
  return (
    <Card data-shot="night-strip" data-shot-states="loading error">
      <Box className={classes.host} data-more={offscreenCount > 0}>
        <Box
          ref={scroller}
          onScroll={measure}
          className={classes.scroller}
          role="group"
          aria-label={offscreenCount > 0 ? `Nights, ${offscreenText.spoken}` : 'Nights'}
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
                <NightBar night={night} gateScale={gateScale} longest={longest} />
                <span className={classes.note}>{nightNote(night)}</span>
                <span className={classes.marker}>
                  {night.date === markedDate ? (allOut ? 'CLOSEST' : 'BEST') : ''}
                </span>
              </button>
            )
          })}
        </Box>
        <span className={classes.more} aria-hidden="true">
          {offscreenText.visible}
        </span>
      </Box>
    </Card>
  )
}
