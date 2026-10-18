/**
 * The zone bands the Strength page's copy and meters share. A leaf module (no page imports) so
 * `constants.ts` can build tooltip text from them without an import cycle through `model.ts`.
 */
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
} from '../garmin-health/model'

export { ACWR_CAUTION_TO, ACWR_FLOOR, ACWR_METER_MAX, ACWR_OPTIMAL_TO }

/** Acute equals chronic: the ACWR line the zones are read against. */
export const ACWR_PARITY = 1

export const READINESS_REST_BELOW = 40
export const READINESS_PUSH_FROM = 70
/** Productive INOL per session and lift (`sessionInol`, `apps/api/src/lib/strength-formulas.ts`). */
export const INOL_OPTIMAL_FROM = 0.6
export const INOL_OPTIMAL_TO = 1.0
/** Rep ranges the API scores: `E1RM_MAX_REPS` (`lib/formulas.ts`) and the wider INOL range. */
export const E1RM_MAX_REPS = 10
export const INOL_MAX_REPS = 12

/** Load Quality verdict cut-offs and component weights (`loadQuality` in `strength-formulas.ts`). */
export const LOAD_QUALITY_QUALITY_FROM = 75
export const LOAD_QUALITY_ADEQUATE_FROM = 50
export const LOAD_QUALITY_WEIGHTS = { inol: 40, acwr: 40, volume: 20 } as const

/** Readiness inputs (`computeReadiness`): recovery weights, fatigue shave and the heavy-session cut. */
export const RECOVERY_WEIGHTS = { hrv: 40, sleep: 35, restingHr: 25 } as const
export const FATIGUE_MAX_SHAVE_PCT = 25
export const HEAVY_SESSION_INOL = 1.2
export const HEAVY_SESSION_DAMPEN_PCT = 10
export const HEAVY_SESSION_HOURS = 48

/** Volume landmarks (`volumeLandmarks`): percentiles of non-zero weekly tonnage over the last 90 d. */
export const LANDMARK_PERCENTILES = { mev: 25, mav: 50, mrv: 90 } as const
export const LANDMARK_DAYS = 90
