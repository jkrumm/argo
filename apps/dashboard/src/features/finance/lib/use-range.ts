import { useMeta } from '../api/queries'
import { resolveRange } from './months'
import { finStore } from '../../../lib/window-stores'

/** The effective month range of the current page and whether the vault has any bookings at all. */
export function useRange() {
  const meta = useMeta()
  const search = finStore.useValues()
  const range = resolveRange(meta.data, search)
  return { range, meta, noData: meta.isSuccess && range === null }
}
