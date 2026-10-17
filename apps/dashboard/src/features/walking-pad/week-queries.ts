import { walkingPadQueries } from '../../lib/queries/walking-pad'

/** Two fixed-window reads the strip and the summary line share: the week reads never follow the selector. */
export const THIS_WEEK_SERIES = walkingPadQueries.series({ window: '30d', bucket: 'week' })
export const WEEK_DAYS_SERIES = walkingPadQueries.series({ window: '7d', bucket: 'day' })
