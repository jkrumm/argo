import { useEffect, useState } from 'react'

const DEFAULT_TICK_MS = 60_000

/**
 * The current time as render-safe state: read once on mount, then refreshed on an interval, so
 * components never call `Date.now()` during render.
 */
export function useNow(tickMs = DEFAULT_TICK_MS): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  return now
}
