import { WALKING_WINDOW_VALUES } from '../../lib/window-stores'

/** Re-exported from the leaf store module so the values, the type, the filter's options and the
 * store's accepted set are all ONE declaration. The LABELS live on the store (`.labels()`). */
export type WindowPreset = (typeof WALKING_WINDOW_VALUES)[number]

// Pace zones (km/h). Calibrated against typical desk-treadmill ranges — most
// users stroll 2.5–4.5 km/h while typing, brisk 4.5–5.5 when no calls, fast
// 5.5–6 for short bursts. Above 6 km/h is essentially jogging-on-walking-pad.
export const PACE_ZONES = [
  { from: 0, to: 2.5, label: 'Stroll', tone: 'soft' as const },
  { from: 2.5, to: 4.5, label: 'Walking', tone: 'neutral' as const },
  { from: 4.5, to: 5.5, label: 'Brisk', tone: 'good' as const },
  { from: 5.5, to: 60, label: 'Power', tone: 'strong' as const },
]

// Default daily distance target — drives the "today vs goal" arc in hero
// stats. The user can adjust later; this is a fixed default that matches a
// 30-minute brisk walk.
export const DAILY_DISTANCE_GOAL_M = 3000
export const WEEKLY_DISTANCE_GOAL_M = 15_000

export const ACHIEVEMENT_WATERMARK_KEY = 'walkingpad-achievements-last-seen'
export const ACHIEVEMENT_LAST_SEEN_ID_KEY = 'walkingpad-achievements-last-seen-id'

// Tooltip explanations for the hero cards.
export const HERO_TOOLTIPS = {
  volume:
    'Total distance walked in the selected window vs the immediately preceding equal-length window. >5% delta moves the verdict; <5% reads as "stable" because daily noise on a desk treadmill is large.',
  pace: "Distance-weighted average walking speed in the selected window vs the preceding equal-length window. Long sessions count more than tiny ones so a single fast burst can't inflate the headline.",
  streak:
    'Consecutive UTC days with at least one real session (≥60s, ≥50m). Best-ever streak shown beneath; momentum compares sessions in the last 7 days vs the prior 7.',
} as const
