/**
 * AreaGradient — the single source for the soft single-hue area fill under a line.
 *
 * Renders a vertical <linearGradient> that fades a series/line color from `--vx-area-top`
 * opacity at the data peak to `--vx-area-bottom` at the baseline. Both stops are
 * `color-mix` of a CSS-var color, so they stay theme-aware AND the dev theme lab can retune
 * the whole app's gradient strength by overriding two vars on :root — no chart edits.
 *
 * Usage (inside an <svg>):
 *   <defs><AreaGradient id={`${chartId}-area`} color={VX.series.hrv} /></defs>
 *   <AreaClosed ... fill={areaFillUrl(`${chartId}-area`)} />
 */

const areaStop = (color: string, edge: 'top' | 'bottom'): string =>
  `color-mix(in srgb, ${color} var(--vx-area-${edge}), transparent)`

export function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={areaStop(color, 'top')} />
      <stop offset="100%" stopColor={areaStop(color, 'bottom')} />
    </linearGradient>
  )
}

export const areaFillUrl = (id: string): string => `url(#${id})`
