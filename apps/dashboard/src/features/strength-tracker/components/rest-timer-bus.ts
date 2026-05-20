type RestStartListener = () => void

const listeners = new Set<RestStartListener>()

/**
 * Trigger every mounted rest timer to start a fresh, full-duration countdown.
 * Used by the workout checklist to auto-rest between sets — decoupled so the
 * set editor doesn't need a handle on the timer panel rendered as its sibling.
 */
export function startRestTimer() {
  for (const fn of listeners) fn()
}

export function subscribeRestTimer(fn: RestStartListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
