/**
 * theme-vars.ts — emits the CSS custom properties consumed by VX tokens + useVxTheme.
 *
 * Why CSS variables: series colors must shift shade per theme (lighter on dark, deeper on
 * light) AND be readable from non-component files (constants.ts, formulas.ts) where a React
 * hook is impossible. CSS vars resolve per Mantine color scheme automatically — zero call-site
 * ripple, and the dev theme switcher can override them on :root to re-theme charts + chrome live.
 *
 * The dashboard injects PALETTE_CSS once (see charts-bridge.tsx). Var names are 1:1 with the
 * palette keys (camelCase preserved) so the mapping in tokens.ts is mechanical.
 */
import {
  SERIES,
  ACTIVITY,
  USAGE_SOURCE,
  USAGE_BILLING,
  USAGE_OUTCOME,
  SEMANTIC,
  STATUS,
  NEUTRAL,
  SURFACE,
  type ColorPair,
} from './palette'

type Side = 'light' | 'dark'

const decl = (name: string, value: string) => `  --vx-${name}: ${value};`

const group = (prefix: string, g: Record<string, ColorPair>, side: Side): string =>
  Object.entries(g)
    .map(([k, v]) => decl(`${prefix}${k}`, v[side]))
    .join('\n')

function primitives(side: Side): string {
  const n = NEUTRAL
  const s = SEMANTIC
  const su = SURFACE
  return [
    group('', SERIES as Record<string, ColorPair>, side),
    group('activity-', ACTIVITY as Record<string, ColorPair>, side),
    group('usage-', USAGE_SOURCE as Record<string, ColorPair>, side),
    group('billing-', USAGE_BILLING as Record<string, ColorPair>, side),
    group('outcome-', USAGE_OUTCOME as Record<string, ColorPair>, side),
    group('status-', STATUS as Record<string, ColorPair>, side),
    decl('goodSolid', s.good[side]),
    decl('badSolid', s.bad[side]),
    decl('warnSolid', s.warn[side]),
    decl('neutral', n.neutral[side]),
    decl('shadowCard', side === 'dark' ? 'none' : '0 1px 3px rgba(17,20,24,0.06)'),
    decl('line', n.line[side]),
    decl('line2', n.line2[side]),
    decl('axis', n.axis[side]),
    decl('axisStroke', n.axisStroke[side]),
    decl('grid', n.grid[side]),
    decl('crosshair', n.crosshair[side]),
    decl('dotStroke', n.dotStroke[side]),
    decl('tooltipBg', n.tooltipBg[side]),
    decl('tooltipText', n.tooltipText[side]),
    decl('tooltipMuted', n.tooltipMuted[side]),
    decl('tooltipBorder', n.tooltipBorder[side]),
    decl('tooltipShadow', n.tooltipShadow[side]),
    decl('legendText', side === 'dark' ? 'rgba(255,255,255,0.92)' : 'rgba(17,20,24,0.82)'),
    decl('surface-bg', su.bg[side]),
    decl('surface-panel', su.panel[side]),
    decl('surface-elevated', su.elevated[side]),
    decl('surface-border', su.border[side]),
  ].join('\n')
}

/**
 * Theme-independent scalars + semantic fills. Defined once on :root.
 *
 * Area-gradient strength is a global knob (the dev theme lab overrides these two on :root
 * to retune every line-area fill live). 0%/0% disables gradients app-wide.
 */
const DERIVED = [
  decl('area-top', '22%'),
  decl('area-bottom', '1%'),
  decl('good', 'color-mix(in srgb, var(--vx-goodSolid) 18%, transparent)'),
  decl('goodSoft', 'color-mix(in srgb, var(--vx-goodSolid) 8%, transparent)'),
  decl('bad', 'color-mix(in srgb, var(--vx-badSolid) 18%, transparent)'),
  decl('warn', 'color-mix(in srgb, var(--vx-warnSolid) 8%, transparent)'),
  decl('goodRef', 'color-mix(in srgb, var(--vx-goodSolid) 30%, transparent)'),
  decl('badRef', 'color-mix(in srgb, var(--vx-badSolid) 30%, transparent)'),
  decl('warnRef', 'color-mix(in srgb, var(--vx-warnSolid) 20%, transparent)'),
  decl('optimalZone', 'color-mix(in srgb, var(--vx-goodSolid) 10%, transparent)'),
].join('\n')

/**
 * Full stylesheet. Dark is the default (`:root`) since the app defaults to dark; the
 * `[data-mantine-color-scheme]` selectors track Mantine's toggle on <html>.
 */
export const PALETTE_CSS = `:root {
${DERIVED}
}
:root,
html[data-mantine-color-scheme='dark'] {
${primitives('dark')}
}
html[data-mantine-color-scheme='light'] {
${primitives('light')}
}`
