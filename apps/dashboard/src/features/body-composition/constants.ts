import type { SkinfoldSite } from '../../lib/queries/skinfold-log'

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
  bodyWeight: 'Daily weight in kg; same-day weigh-ins are averaged.',
  bodyWeightGoal: 'Daily weight in kg against the goal weight; same-day weigh-ins are averaged.',
  skinfoldChart: 'Fold thickness in mm per caliper site; thinner folds mean lower body fat.',
} as const
