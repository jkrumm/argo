/**
 * Apply opacity to any palette token, theme-aware. Use instead of raw rgba() so the
 * underlying hue still resolves per color scheme.
 *
 *   alpha(VX.neutral, 0.5)            // muted hairline
 *   alpha(VX.series.benchPress, 0.08) // soft tint of a series color
 *   alpha(VX.status.warn, 0.1)        // zone-band fill
 */
export const alpha = (token: string, a: number): string =>
  `color-mix(in srgb, ${token} ${Math.round(a * 100)}%, transparent)`
