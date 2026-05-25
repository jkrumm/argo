type RestStartListener = () => void

const listeners = new Set<RestStartListener>()

/**
 * Trigger a fresh, full-duration rest countdown on the app-level timer engine.
 * Used by the workout checklist to auto-rest between sets — decoupled so the set
 * editor doesn't need a handle on the timer store or the engine subscriber.
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
