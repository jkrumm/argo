import type { IngReadDue } from '../api/types'

/** The banner's text while a supervised ING read is due, else null. The banner starts nothing. */
export function readDueText(readDue: IngReadDue | undefined): string | null {
  if (readDue?.due !== true) return null
  const since = readDue.since === null ? '' : ` since ${readDue.since}`
  return `ING announced new Post-Box documents${since}. A supervised ING read is due.`
}
