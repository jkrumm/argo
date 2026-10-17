import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { utcDayKey } from './model'

const BASE = walkingPadQueries.series({ window: '30d', bucket: 'day' })

/**
 * One fixed-window day read the strip and the summary line share: the week reads never follow the
 * selector. The UTC day rides the query key, so a tab left open across UTC midnight refetches and
 * today's bucket exists.
 */
export const weekDaysSeries = (nowMs: number) => ({
  ...BASE,
  // The factory's key is a fixed 3-tuple; the extra element only widens the cache identity.
  queryKey: [...BASE.queryKey, utcDayKey(nowMs)] as unknown as typeof BASE.queryKey,
})
