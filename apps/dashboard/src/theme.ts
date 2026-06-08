import {
  Card,
  createTheme,
  type CSSVariablesResolver,
  Input,
  type MantineColorsTuple,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  Textarea,
  TextInput,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { BP } from '@argo/charts'

/**
 * Mantine chrome reskinned to the Blueprint palette so the UI shell shares the charts'
 * identity. Every Mantine accent (red/teal/yellow/…) is overridden with a Blueprint family,
 * so existing `color="teal"`-style props become on-palette with zero call-site changes.
 *
 * BP (the canonical palette) lives in packages/charts/src/palette.ts. theme.ts is allowed to
 * import the pure palette DATA — the architectural rule (charts-bridge is the only Mantine↔charts
 * bridge) is about the runtime color-scheme bridge, not sharing constants.
 */

// Blueprint families are 5 stops dark→light. Expand to a 10-shade Mantine tuple (light→dark).
function hexToRgb(h: string): [number, number, number] {
  const n = Number.parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const c = A.map((v, i) => Math.round(v + (B[i]! - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
function ramp10(stops: readonly string[]): MantineColorsTuple {
  const lite = stops.toReversed() // light→dark
  const out: string[] = []
  for (let i = 0; i < 10; i++) {
    const pos = (i / 9) * (lite.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.min(lo + 1, lite.length - 1)
    out.push(mix(lite[lo]!, lite[hi]!, pos - lo))
  }
  out[0] = mix(out[0]!, '#ffffff', 0.5) // extra-light tint for light-variant backgrounds
  return out as unknown as MantineColorsTuple
}

// Blueprint neutral ramp at the indices Mantine reads:
// text=dark[0], dimmed=dark[2], border=dark[4], hover=dark[5], surface=dark[6], body=dark[7].
const bpDark: MantineColorsTuple = [
  '#c5cbd3',
  '#abb3bf',
  '#8f99a8',
  '#738091',
  '#383e47',
  '#2f343c',
  '#252a31',
  '#1c2127',
  '#181c22',
  '#111418',
]

/**
 * Inputs default to `md` (16px font) so iOS Safari never zooms the viewport on
 * focus. The base `Input` default does not cascade to TextInput/Select/etc.
 * (each component resolves its own `size` and passes it down), so every input
 * is set explicitly. The CSS safety net in `styles/native.css` covers anything
 * not listed here.
 */
export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: { light: 6, dark: 4 }, // deeper on light, lighter on dark (no glow)
  autoContrast: true,
  luminanceThreshold: 0.45,
  white: '#ffffff',
  black: '#111418',
  // Tight, precise radii (Linear/Carbon). v9's default is `md` (8px); Argo pins `sm` (4px) for
  // buttons/inputs/badges and bumps cards to `md` (8px). See docs/MANTINE-THEMING.md §8.1.
  defaultRadius: 'sm',
  // Numbers render mono+tabular (DESIGN.md typography.number) — keeps metric columns aligned.
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, monospace",
  // Named weight ladder (v9 fontWeights) — matches DESIGN.md typography weights.
  fontWeights: { normal: '400', medium: '500', semibold: '600', bold: '700' },
  // Deliberate, OWNED spacing + radius scales — no longer inherited Mantine defaults. The values
  // match v9 today (so this is a zero-pixel ownership step), but they now live here as the single
  // edit point and the reference `scripts/check-theme.mjs` enforces against. A strict 4px-grid
  // tightening (xs 10→8, lg 20→24) + tighter large radii is a ready follow-up — change here and
  // re-validate density. See DESIGN.md (spacing / rounded) + docs/MANTINE-THEMING.md §8.3.
  spacing: { xs: '0.625rem', sm: '0.75rem', md: '1rem', lg: '1.25rem', xl: '2rem' }, // 10 12 16 20 32
  radius: { xs: '0.125rem', sm: '0.25rem', md: '0.5rem', lg: '1rem', xl: '2rem' }, // 2 4 8 16 32
  colors: {
    dark: bpDark,
    gray: ramp10(BP.gray),
    blue: ramp10(BP.blue),
    cyan: ramp10(BP.cerulean),
    teal: ramp10(BP.turquoise),
    green: ramp10(BP.forest),
    lime: ramp10(BP.lime),
    yellow: ramp10(BP.gold),
    orange: ramp10(BP.orange),
    red: ramp10(BP.red),
    pink: ramp10(BP.rose),
    grape: ramp10(BP.violet),
    violet: ramp10(BP.violet),
    indigo: ramp10(BP.indigo),
  },
  components: {
    // Depth = surface change + 1px hairline, never a drop shadow (DESIGN.md Elevation). Cards sit
    // at md (8px) while controls stay tight at sm (4px). The hairline is --vx-surface-border.
    Card: Card.extend({ defaultProps: { withBorder: true, radius: 'md' } }),
    Paper: Paper.extend({ defaultProps: { withBorder: true } }),
    Input: Input.extend({ defaultProps: { size: 'md' } }),
    TextInput: TextInput.extend({ defaultProps: { size: 'md' } }),
    NumberInput: NumberInput.extend({ defaultProps: { size: 'md' } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { size: 'md' } }),
    Select: Select.extend({ defaultProps: { size: 'md' } }),
    Textarea: Textarea.extend({ defaultProps: { size: 'md' } }),
    DatePickerInput: DatePickerInput.extend({ defaultProps: { size: 'md' } }),
  },
})

/**
 * Bind Mantine's surface system to the SAME `--vx-*` variables the charts use, so chrome and
 * charts draw from one set of scheme-reactive surfaces (see docs/MANTINE-THEMING.md §4).
 *
 * These bindings MUST live in the `light`/`dark` blocks, not the scheme-independent `variables`
 * block: Mantine declares the surface vars under the `[data-mantine-color-scheme]` selector, which
 * outranks a `:root` rule — so a `variables` binding loses to Mantine's per-scheme default. The
 * light/dark blocks are injected under the same scheme selector, at matching specificity, after.
 * (The `--vx-*` refs are themselves scheme-resolved; the per-scheme hex fallbacks guard a brief
 * window before PALETTE_CSS injects.) Primary text (`--mantine-color-text`) is intentionally left
 * to Mantine: `--vx-line` is a mid-grey chart stroke, too weak for body copy.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-body': 'var(--vx-surface-bg, #f6f7f9)', // page background
    '--mantine-color-default': 'var(--vx-surface-panel, #ffffff)', // cards / default controls
    '--mantine-color-default-hover': 'var(--vx-surface-elevated, #ffffff)',
    '--mantine-color-default-border': 'var(--vx-surface-border, #dce0e5)', // the hairline
    '--mantine-color-dimmed': 'var(--vx-neutral, #5f6b7c)', // secondary / muted text
  },
  dark: {
    '--mantine-color-body': 'var(--vx-surface-bg, #1c2127)',
    '--mantine-color-default': 'var(--vx-surface-panel, #252a31)',
    '--mantine-color-default-hover': 'var(--vx-surface-elevated, #2f343c)',
    '--mantine-color-default-border': 'var(--vx-surface-border, #383e47)',
    '--mantine-color-dimmed': 'var(--vx-neutral, #8f99a8)',
  },
})
