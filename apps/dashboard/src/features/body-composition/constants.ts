import type { SkinfoldSite } from '../../lib/queries/skinfold-log'

export type WindowPreset = '7d' | '30d' | '90d' | 'all'

export const WINDOW_PRESET_OPTIONS: { value: WindowPreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
]

export const WINDOW_STORAGE_KEY = 'argo:body-composition:window'

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
    'Logged weight (kg) over time with 7-day centered MA. Goal weight shown as horizontal reference line when set in profile.',
  skinfoldSummary:
    'Rolling skinfold-thickness stats from manual caliper readings. Each date is reduced to a session average across sites before rolling stats are computed. ma7/ma30 = average of most-recent 7/30 dated averages. Trend: ma7 vs ma30 — down (leaner) is the good direction. direction classifies the trailing 28-day mm/week slope: reducing (good, leaner) · increasing · stable.',
  skinfoldChart:
    'One line per caliper site plus a bold average line, per date. Thinner drop in thickness over time indicates reducing body fat.',
} as const
