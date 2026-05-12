import { VX } from '@argo/charts'

export type ExerciseKey = 'bench_press' | 'deadlift' | 'squat' | 'pull_ups'

export type SetType = 'warmup' | 'work' | 'drop' | 'amrap'

export type MetricKey =
  | 'estimated_1rm'
  | 'max_weight'
  | 'total_volume'
  | 'total_reps'
  | 'work_sets'
  | 'avg_intensity'

export type WindowPreset = '7d' | '30d' | '3m' | '6m' | '1y' | 'ytd' | 'all'

export const DEFAULT_EXERCISES: ExerciseKey[] = ['bench_press', 'deadlift', 'squat', 'pull_ups']

export const EXERCISES: { value: ExerciseKey; label: string }[] = [
  { value: 'bench_press', label: 'Bench Press' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'squat', label: 'Squat' },
  { value: 'pull_ups', label: 'Pull-ups' },
]

export const EXERCISE_COLORS: Record<ExerciseKey, string> = {
  bench_press: VX.series.benchPress,
  deadlift: VX.series.deadlift,
  squat: VX.series.squat,
  pull_ups: VX.series.pullUps,
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

export const WINDOW_PRESET_OPTIONS: { value: WindowPreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
]

export const WINDOW_STORAGE_KEY = 'argo:strength-tracker:window'
export const EXERCISES_STORAGE_KEY = 'argo:strength-tracker:exercises'
export const VIEW_STORAGE_KEY = 'argo:strength-tracker:view'

export const METRIC_TOOLTIPS = {
  oneRmTrend:
    'Estimated 1-rep max per session using Brzycki + Epley average. Only work/AMRAP sets with 1–12 reps count. Dashed line = 30-day moving average. Stars = personal records. Direction arrow (▲►▼) from 28-day linear regression of e1RM.',
  strengthComposite:
    "Three independent signals z-scored to your own 90-day baseline. Velocity (f'): e1RM growth rate. Tonnage growth: weekly volume vs 28-day MA. INOL quality: session load index (0.6–1.0 = optimal). All on a shared σ axis — up means above your own average.",
  weeklyVolume:
    'Weekly tonnage (weight × reps) broken down by set type. Dashed line = 4-week moving average. Ref lines: MEV (p25), MAV (p50), MRV (p90) computed from 90-day window — use as rough volume landmarks.',
  trainingLoad:
    'Acute:chronic workload ratio — 4-week vs 16-week EWMA of weekly tonnage per exercise. Green zone (0.8–1.3) = optimal adaptation stimulus. Below 0.8 = undertrained. 1.3–1.5 = caution. Above 1.5 = injury risk.',
  inol: 'INOL (Intensity × Number Of Lifts) = Σ reps / (100 − %1RM) per session. Optimal zone 0.6–1.0. Below is underdosing, above is high CNS fatigue. Only work/AMRAP sets with 1–12 reps count.',
  momentum:
    'e1RM trend with 8-session moving average (top). Velocity (%/day, 28-day linear regression) in the bottom panel — green bars = positive trend, red = decline.',
  relativeProgression:
    'Each lift normalized to 100% at the start of the selected date range. Shows relative momentum — which lifts are gaining, which are stalling — independent of absolute strength levels.',
  strengthRatios:
    'DOTS-adjusted strength ratios vs IPF normative ranges (809,986 entries). Green band = expected range. Colored tick = current ratio. ✓ balanced · △ imbalanced (>15% off) · ✗ critical (>30% off). Pull-up ratio = added weight / bodyweight.',
  heroStrength:
    "Strength Direction: 3-level verdict (Improving/Stable/Declining) from 28-day e1RM velocity (f') for the leader lift. Sub-text shows f'' sign — accelerating means the trend is steepening, decelerating means it's tapering.",
  heroLoadQuality:
    'Load Quality: 0–100 composite. 40% INOL zone score (optimal: 0.6–1.0) + 40% ACWR zone score (optimal: 0.8–1.3) + 20% weekly volume vs personal MEV/MAV landmarks. ≥75 = Quality · 50–74 = Adequate · <50 = Poor.',
  heroBalance:
    'Balance: DOTS-adjusted ratio status across DL/Squat, Squat/Bench, DL/Bench, and Pull-up/BW. Shows the worst-offender pair. Balanced = all ratios within normative range. Imbalanced = >15% off. Critical = >30% off.',
  heroReadiness:
    'Readiness: Garmin recovery score adjusted for strength fatigue. Penalty = INOL of last session / personal p90 ceiling × 25% max shave. An additional 10% dampening applies if the last session had INOL > 1.2 within 48h. Push ≥ 70 · Normal 40–69 · Rest < 40.',
  readinessStrain:
    'Adjusted readiness: Garmin recovery score (HRV 40% + sleep 35% + RHR 25%) × (1 − fatigue_debt × 0.25). Fatigue debt = last session INOL / p90 INOL ceiling. Heavy session (INOL > 1.2) adds a further 10% dampening. Zone thresholds: Push ≥ 70 · Normal 40–69 · Rest < 40.',
  trainingRecoveryAlignment:
    "3×3 matrix: rows = recovery zone (High/Normal/Low), cols = training load ACWR (Under/Optimal/Caution). Each cell shows sessions in that zone combination. Today's cell has a colored border. Aligned cells = recovery and load match. Misaligned cells = conflict between body state and training load.",
  bodyWeight:
    'Logged weight (kg) over time with 7-day centered MA. Goal weight shown as horizontal reference line when set in profile.',
  strengthScan:
    'One row per lift: 1RM trend, weekly volume, INOL quality, momentum (28d velocity), and a status indicator.',
} as const

/**
 * Zone colors for the hero cards. Theme-independent traffic-light colors so
 * the score is unambiguous in both light and dark mode (mirrors garmin-health).
 */
export const ZONE_COLORS = {
  excellent: '#00c853',
  good: '#64dd17',
  warn: '#ffd600',
  bad: '#ff3d00',
  neutral: '#999',
} as const
