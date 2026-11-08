import type { Phase } from '../features/strength-tracker/components/timer-core'

/** Seconds left, rounded UP to 100 ms, so the store only changes when the display could. */
export function displayRemaining(endAt: number, now: number): number {
  return Math.ceil(Math.max(0, endAt - now) / 100) / 10
}

export type IntervalAdvance = {
  phaseIndex: number
  endAt: number
  /** Phases entered by this step; 0 while the current phase is still running. */
  entered: number
  finished: boolean
}

/**
 * Walks the interval forward to `now`. Each next phase starts where the previous one ended, not at
 * `now`, so a late tick (hidden tab, throttled timer) never shifts the rest of the schedule.
 */
export function advanceInterval(
  phases: Phase[],
  phaseIndex: number,
  endAt: number,
  now: number,
): IntervalAdvance {
  let index = phaseIndex
  let end = endAt
  let entered = 0
  while (now >= end) {
    const next = phases[index + 1]
    if (!next) return { phaseIndex: index, endAt: end, entered, finished: true }
    index += 1
    end += next.dur * 1000
    entered += 1
  }
  return { phaseIndex: index, endAt: end, entered, finished: false }
}
