import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

/** Where a menu opens: the pointer, or the middle of the row it was asked from by keyboard. */
export type MenuAt = { x: number; y: number }

const LONG_PRESS_MS = 500
const MOVED_PX = 8

/**
 * Handlers that open a menu from a right-click, a long press of a finger or the keyboard's menu key. Spread them on the
 * row; `open` receives where to put the menu.
 */
export function useMenuTrigger(open: (at: MenuAt) => void) {
  const timer = useRef<number | null>(null)
  const start = useRef<MenuAt | null>(null)
  const firedAt = useRef(0)

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  return {
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      event.preventDefault()
      // A long press on Android sends this event too: the timer has opened the menu already.
      if (Date.now() - firedAt.current < 1000) return
      const rect = event.currentTarget.getBoundingClientRect()
      const keyboard = event.clientX === 0 && event.clientY === 0
      open(
        keyboard
          ? { x: rect.left + 16, y: rect.top + rect.height / 2 }
          : { x: event.clientX, y: event.clientY },
      )
    },
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType === 'mouse') return
      const at = { x: event.clientX, y: event.clientY }
      start.current = at
      cancel()
      timer.current = window.setTimeout(() => {
        firedAt.current = Date.now()
        open(at)
      }, LONG_PRESS_MS)
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const from = start.current
      if (from === null) return
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVED_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  }
}
