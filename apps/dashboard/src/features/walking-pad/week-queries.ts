import { walkingPadQueries } from '../../lib/queries/walking-pad'

/** One fixed-window day read the strip and the summary line share: the week reads never follow the selector. */
export const WEEK_DAYS_SERIES = walkingPadQueries.series({ window: '30d', bucket: 'day' })
