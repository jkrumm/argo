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

export const READINESS_REST_BELOW = 40
export const READINESS_PUSH_FROM = 70
/** Productive INOL per session and lift (`sessionInol`, `apps/api/src/lib/strength-formulas.ts`). */
export const INOL_OPTIMAL_FROM = 0.6
export const INOL_OPTIMAL_TO = 1.0
/** Rep ranges the API scores: `E1RM_MAX_REPS` (`lib/formulas.ts`) and the wider INOL range. */
export const E1RM_MAX_REPS = 10
export const INOL_MAX_REPS = 12
