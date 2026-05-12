import type { WindowParams } from '../../lib/queries/daily-metrics'

/**
 * The window/range parameters every Garmin Health chart and card receives.
 * Shape matches what the API's `WindowQuerySchema` accepts.
 */
export type SummaryParams = WindowParams
