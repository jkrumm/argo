/**
 * The lineage under the pointer on any of the three scatters: transient, so it is not a store field
 * (nothing links to it). Every chart reads it to light the same ladder.
 */
import { useSyncExternalStore } from 'react'

let current = ''
const listeners = new Set<() => void>()

export function setHoverLineage(lineage: string): void {
  if (lineage === current) return
  current = lineage
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useHoverLineage = (): string =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => '',
  )
