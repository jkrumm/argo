import { VISIBLE_DATE_MIN } from '../constants'
import { chartEmpty, windowCopyDays } from '../model'
import type { SummaryParams } from '../types'

/** A chart card's empty label for the page's selected window (`chartEmpty`'s one wording). */
export const emptyIn = (metric: string, params: SummaryParams): string =>
  chartEmpty(metric, windowCopyDays(params, VISIBLE_DATE_MIN))
