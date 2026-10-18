import { VISIBLE_DATE_MIN } from '../constants'
import { chartEmpty, windowCopyDays } from '../model'
import type { SummaryParams } from '../types'

/** A chart card's empty label for the page's selected window (`chartEmpty`'s short form: the strip leads with the full sentence). */
export const emptyIn = (metric: string, params: SummaryParams): string =>
  chartEmpty(metric, windowCopyDays(params, VISIBLE_DATE_MIN), 'short')
