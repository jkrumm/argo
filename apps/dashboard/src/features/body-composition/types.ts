export type { WindowPreset } from './constants'

/**
 * Window/range parameters both body-composition endpoints (weight-log, skinfold-log)
 * accept. Matches the API's `WindowQuerySchema`.
 */
export type SummaryParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}
