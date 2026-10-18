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
  acwr: `Acute:chronic workload ratio: your recent weekly tonnage (4-week EWMA) divided by your long-run average (16-week EWMA). ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO} is the healthy range; above ${ACWR_CAUTION_TO} raises injury risk.`,
  inol: `INOL, the load of one session on one lift: reps ÷ (100 − %1RM), summed over its work and AMRAP sets of 1–${INOL_MAX_REPS} reps. ${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO} is productive; above ${INOL_OPTIMAL_TO} is heavy.`,
} as const

export const METRIC_TOOLTIPS = {
  oneRmTrend: `Estimated 1-rep max per session: the best work or AMRAP set of 1–${E1RM_MAX_REPS} reps, scored as the average of the Brzycki and Epley formulas. Higher-rep sets are left unscored because the two formulas diverge above ${E1RM_MAX_REPS} reps. The direction arrow is the slope of the last 28 days.`,
  strengthComposite: `Three signals, each in standard deviations from your own 90-day average: e1RM growth rate, weekly tonnage growth against its 28-day average, and session INOL quality (${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO} is productive). Above zero is better than your norm.`,
  weeklyVolume:
    'Weekly tonnage (weight × reps) by set type. MEV, MAV and MRV are the 25th, 50th and 90th percentile of your weekly tonnage over the last 90 days: a rough minimum, productive and maximum volume.',
  trainingLoad: `${TERM_DEFINITIONS.acwr} Computed per exercise. Below ${ACWR_FLOOR} is undertrained, ${ACWR_OPTIMAL_TO}–${ACWR_CAUTION_TO} is caution.`,
  inol: TERM_DEFINITIONS.inol,
  momentum:
    'Velocity is the slope of a 28-day linear fit of e1RM, in % per month. Positive means strength is rising.',
  relativeProgression:
    'Each lift as a percentage of its e1RM on the first day of the selected range, so lifts of different absolute strength compare directly.',
  strengthRatios:
    'DOTS-adjusted lift ratios against IPF normative ranges (809,986 entries). Balanced is within 15 % of the range, critical more than 30 % off. The pull-up ratio is added weight over bodyweight.',
  heroStrength:
    "Strength Direction: 3-level verdict (Improving/Stable/Declining) from 28-day e1RM velocity (f') for the leader lift. Sub-text shows f'' sign — accelerating means the trend is steepening, decelerating means it's tapering.",
  heroLoadQuality:
    'Load Quality: 0–100 composite. 40% INOL zone score (optimal: 0.6–1.0) + 40% ACWR zone score (optimal: 0.8–1.3) + 20% weekly volume vs personal MEV/MAV landmarks. ≥75 = Quality · 50–74 = Adequate · <50 = Poor.',
  heroBalance:
    'Balance: DOTS-adjusted ratio status across DL/Squat, Squat/Bench, DL/Bench, and Pull-up/BW. Shows the worst-offender pair. Balanced = all ratios within normative range. Imbalanced = >15% off. Critical = >30% off.',
  heroReadiness: `Readiness: Garmin recovery score adjusted for strength fatigue. Penalty = INOL of last session / personal p90 ceiling × 25% max shave. An additional 10% dampening applies if the last session had INOL > 1.2 within 48h. Push ≥ ${READINESS_PUSH_FROM} · Normal ${READINESS_REST_BELOW}–${READINESS_PUSH_FROM - 1} · Rest < ${READINESS_REST_BELOW}.`,
  readinessStrain: `${TERM_DEFINITIONS.readiness} Recovery is HRV 40 %, sleep 35 %, resting HR 25 %; fatigue takes up to 25 %: the last session's INOL over your 90th-percentile INOL, and a session above INOL 1.2 within 48 h takes a further 10 %.`,
  trainingRecoveryAlignment:
    'Sessions counted by recovery zone (High, Normal, Low) against training load (per-lift average ACWR: Under, Optimal, Caution). Aligned means recovery and load match; misaligned means they conflict.',
  strengthScan: `Momentum is the 28-day e1RM velocity in % per month; INOL quality is productive at ${INOL_OPTIMAL_FROM}–${INOL_OPTIMAL_TO}.`,
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
