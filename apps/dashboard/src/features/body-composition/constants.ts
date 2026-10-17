import type { SkinfoldSite } from '../../lib/queries/skinfold-log'
import { BODY_COMP_WINDOW_VALUES } from '../../lib/window-stores'

/** Re-exported from the leaf store module so the values, the type, the Select options,
 * the route's zod enum and the store's accepted set are all ONE declaration. */
export const WINDOW_PRESET_VALUES = BODY_COMP_WINDOW_VALUES

export type WindowPreset = (typeof WINDOW_PRESET_VALUES)[number]

export const WINDOW_PRESET_OPTIONS: { value: WindowPreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
]

/**
 * UI registry for skinfold caliper sites — order = display order. Keys must match the
 * API's `SKINFOLD_SITES` (apps/api/src/lib/skinfold-sites.ts).
 */
export const SKINFOLD_SITES: { key: SkinfoldSite; label: string; description: string }[] = [
  { key: 'abdominal', label: 'Abdomen', description: 'Vertical fold 2 cm lateral to the navel' },
  {
    key: 'suprailiac',
    label: 'Suprailiac',
    description: 'Diagonal fold above the hip bone (flank)',
  },
]

export const METRIC_TOOLTIPS = {
  bodyWeight:
    'One point per logged day (same-day weigh-ins averaged). Dashed line: centred 7-day mean.',
  bodyWeightGoal:
    'One point per logged day (same-day weigh-ins averaged). Dashed lines: centred 7-day mean and the profile goal weight.',
  skinfoldChart:
    'One line per caliper site, dashed line: the session average. Thinner folds mean lower body fat.',
} as const
