import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../lib/series'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_OPTIMAL_TO,
  E1RM_MAX_REPS,
  INOL_MAX_REPS,
  INOL_OPTIMAL_FROM,
  INOL_OPTIMAL_TO,
  FATIGUE_MAX_SHAVE_PCT,
  HEAVY_SESSION_DAMPEN_PCT,
  HEAVY_SESSION_HOURS,
  HEAVY_SESSION_INOL,
  LANDMARK_DAYS,
  LANDMARK_PERCENTILES,
  LOAD_QUALITY_ADEQUATE_FROM,
  LOAD_QUALITY_QUALITY_FROM,
  LOAD_QUALITY_WEIGHTS,
  RECOVERY_WEIGHTS,
  READINESS_PUSH_FROM,
  READINESS_REST_BELOW,
} from './bands'
import { EXERCISE_KEYS, STRENGTH_WINDOW_VALUES } from '../../lib/window-stores'

export type ExerciseKey = (typeof EXERCISE_KEYS)[number]

export type SetType = 'warmup' | 'work' | 'drop' | 'amrap'

export type MetricKey =
  | 'estimated_1rm'
  | 'max_weight'
  | 'total_volume'
  | 'total_reps'
  | 'work_sets'
  | 'avg_intensity'

/** Re-exported from the leaf store module so the values, the type, the Select options,
 * the route's zod enum and the store's accepted set are all ONE declaration. */
export const WINDOW_PRESET_VALUES = STRENGTH_WINDOW_VALUES

export type WindowPreset = (typeof WINDOW_PRESET_VALUES)[number]

export const DEFAULT_EXERCISES: ReadonlyArray<ExerciseKey> = EXERCISE_KEYS

export const EXERCISES: { value: ExerciseKey; label: string }[] = [
  { value: 'bench_press', label: 'Bench Press' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'squat', label: 'Squat' },
  { value: 'pull_ups', label: 'Pull-ups' },
]

export const EXERCISE_COLORS: Record<ExerciseKey, string> = {
  bench_press: SERIES.benchPress,
  deadlift: SERIES.deadlift,
  squat: SERIES.squat,
  pull_ups: SERIES.pullUps,
}

export const SET_TYPE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'work', label: 'Work' },
  { value: 'drop', label: 'Drop' },
  { value: 'amrap', label: 'AMRAP' },
]

export const METRICS: { value: MetricKey; label: string; unit: string }[] = [
  { value: 'estimated_1rm', label: 'Est. 1RM', unit: 'kg' },
  { value: 'max_weight', label: 'Max Weight', unit: 'kg' },
  { value: 'total_volume', label: 'Total Volume', unit: 'kg' },
  { value: 'total_reps', label: 'Total Reps', unit: 'reps' },
  { value: 'work_sets', label: 'Work Sets', unit: 'sets' },
  { value: 'avg_intensity', label: 'Avg Intensity', unit: '%' },
]

/**
 * One definition per term, with its bands built from the model's constants so the copy cannot
 * drift from what the page computes. Tooltips below reference these instead of restating them.
 */
export const TERM_DEFINITIONS = {
  readiness: `Readiness score, 0–100: the Garmin recovery score (HRV, sleep, resting heart rate) reduced by the fatigue of your last session. Push from ${READINESS_PUSH_FROM}, Rest below ${READINESS_REST_BELOW}.`,
  acwr: `ACWR, the acute:chronic workload ratio: how heavy your recent training is against what you are used to. It divides the 4-week smoothed average of weekly tonnage (weight × reps) by its 16-week one. ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO} is the healthy range; above ${ACWR_CAUTION_TO} raises injury risk. The headline figure sums all lifts.`,
  inol: `INOL, the load of one session on one lift: reps ÷ (100 − %1RM), summed over its work and AMRAP (as many reps as possible) sets of 1–${INOL_MAX_REPS} reps. ${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO} is productive; above ${INOL_OPTIMAL_TO} is heavy.`,
} as const

export const METRIC_TOOLTIPS = {
  oneRmTrend: `Estimated 1-rep max per session: the best work or AMRAP set of 1–${E1RM_MAX_REPS} reps, scored as the average of the Brzycki and Epley formulas. Higher-rep sets are left unscored because the two formulas diverge above ${E1RM_MAX_REPS} reps.`,
  strengthComposite: `Three signals, each in standard deviations from your own 90-day average. e1RM growth rate and weekly tonnage growth (against its 28-day average): above zero is faster than your norm. INOL quality: above zero is heavier sessions than your norm, which is only better up to ${INOL_OPTIMAL_TO} (${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO} is productive).`,
  weeklyVolume: `Weekly tonnage (weight × reps) by set type. MEV, MAV and MRV are the ${LANDMARK_PERCENTILES.mev}th, ${LANDMARK_PERCENTILES.mav}th and ${LANDMARK_PERCENTILES.mrv}th percentile of the selected lift's non-zero weekly tonnage over the last ${LANDMARK_DAYS} days of the selected range (all of it when the range is shorter): a rough minimum, productive and maximum volume.`,
  trainingLoad: `${TERM_DEFINITIONS.acwr} The lines are one per lift, each from that lift's own weekly tonnage. Below ${ACWR_FLOOR} is undertrained, ${ACWR_OPTIMAL_TO}–${ACWR_CAUTION_TO} is caution.`,
  inol: TERM_DEFINITIONS.inol,
  momentum:
    'Velocity is the slope of a 28-day linear fit of e1RM, in % per month. Positive means strength is rising.',
  relativeProgression:
    'Each lift as the percentage change of its e1RM from its first session in the selected window, so lifts of different absolute strength compare directly.',
  strengthRatios:
    'Lift-to-lift ratios against IPF normative ranges (809,986 entries). The three lift pairs compare DOTS scores, which scale each lift by body weight; the pull-up ratio is added weight over body weight. Balanced: inside the band, or within 15 % of its nearest edge. Borderline: balanced only through that 15 %. Imbalanced: more than 15 % outside the band. Critical: more than 30 %.',
  heroStrength:
    "Strength Direction: 3-level verdict (Improving/Stable/Declining) from 28-day e1RM velocity (f') for the leader lift. Sub-text shows f'' sign — accelerating means the trend is steepening, decelerating means it's tapering.",
  heroLoadQuality: `Load Quality: 0–100 composite. ${LOAD_QUALITY_WEIGHTS.inol}% INOL zone score (optimal: ${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO}) + ${LOAD_QUALITY_WEIGHTS.acwr}% ACWR zone score (optimal: ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO}) + ${LOAD_QUALITY_WEIGHTS.volume}% weekly volume vs personal MEV/MAV landmarks. ≥${LOAD_QUALITY_QUALITY_FROM} = Quality · ${LOAD_QUALITY_ADEQUATE_FROM}–${LOAD_QUALITY_QUALITY_FROM - 1} = Adequate · <${LOAD_QUALITY_ADEQUATE_FROM} = Poor.`,
  heroBalance:
    'Balance: lift-ratio status across DL/Squat, Squat/Bench, DL/Bench (each compares DOTS scores, which scale a lift by body weight) and Pull-up/BW (added weight over body weight). Shows the worst pair. Balanced: inside the band or within 15 % of its nearest edge. Imbalanced: more than 15 % outside. Critical: more than 30 %.',
  heroReadiness: `Readiness: Garmin recovery score adjusted for strength fatigue. Penalty = INOL of last session / personal p90 ceiling × ${FATIGUE_MAX_SHAVE_PCT}% max shave. An additional ${HEAVY_SESSION_DAMPEN_PCT}% dampening applies if the last session had INOL > ${HEAVY_SESSION_INOL} within ${HEAVY_SESSION_HOURS}h. Push ≥ ${READINESS_PUSH_FROM} · Normal ${READINESS_REST_BELOW}–${READINESS_PUSH_FROM - 1} · Rest < ${READINESS_REST_BELOW}.`,
  readinessStrain: `${TERM_DEFINITIONS.readiness} Recovery is HRV ${RECOVERY_WEIGHTS.hrv} %, sleep ${RECOVERY_WEIGHTS.sleep} %, resting HR ${RECOVERY_WEIGHTS.restingHr} %; fatigue takes up to ${FATIGUE_MAX_SHAVE_PCT} %: the last session's INOL over your 90th-percentile INOL, and a session above INOL ${HEAVY_SESSION_INOL} within ${HEAVY_SESSION_HOURS} h takes a further ${HEAVY_SESSION_DAMPEN_PCT} %.`,
  trainingRecoveryAlignment:
    'Sessions counted by recovery zone (High, Normal, Low) against training load (per-lift average ACWR: Under, Optimal, Caution). Aligned means recovery and load match; misaligned means they conflict.',
  strengthScan: `The 28 d trend is the e1RM velocity over 28 days, in % per month; INOL quality is productive at ${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO}.`,
} as const

/**
 * Hero-card grade colors — the Blueprint STATUS scale (theme-aware traffic-light,
 * mirrors garmin-health).
 */
export const ZONE_COLORS = {
  excellent: VX.status.excellent,
  good: VX.status.good,
  warn: VX.status.warn,
  bad: VX.status.bad,
  neutral: VX.status.neutral,
} as const
