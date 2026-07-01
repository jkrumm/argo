export const SKINFOLD_SITES = ['abdominal', 'suprailiac'] as const
export type SkinfoldSite = (typeof SKINFOLD_SITES)[number]
