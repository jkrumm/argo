import { activitiesRange } from '../../../lib/queries/activities-window'
import { VISIBLE_DATE_MIN } from '../constants'
import { chartEmpty, windowDayCount } from '../model'
import type { SummaryParams } from '../types'

/** A chart card's empty label for the page's selected window (`chartEmpty`'s one wording). */
export const emptyIn = (metric: string, params: SummaryParams): string =>
  chartEmpty(metric, windowDayCount(activitiesRange(params), VISIBLE_DATE_MIN))
