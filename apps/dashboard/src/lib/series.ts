/**
 * series.ts — Argo's per-metric color vocabulary, expressed with basalt-ui's `defineSeries` /
 * `seriesTokens` / `groupTokens` mechanism (see `basalt-ui/tokens`).
 *
 * Mapping doctrine ("ink earns its color", basalt-ui `docs/DESIGN-SPEC.md` / `packages/charts/
 * src/palette.ts`):
 *  - Every pair value below is COPIED from basalt's own `BP` hue families (`basalt-ui/tokens`) —
 *    no raw hex is invented here. Most families (red/orange/green/forest/gold/vermilion/cerulean/
 *    sepia/…) are byte-identical to argo's pre-migration Blueprint palette, so a metric keeps its
 *    exact hue unless it was anchored on the old Blueprint BLUE identity.
 *  - Metrics that were pinned to Blueprint BLUE (the old identity anchor: hrv, sleepDuration,
 *    steps, benchPress, walkingDistance, the sleep-stage blue siblings, cycling, claudeCode, iu)
 *    now draw from basalt's `BP.blue` family — which IS the new saturated sky accent hue (see
 *    `basalt-ui`'s `tokens/palette.ts` header comment) — at the SAME per-metric shade indices as
 *    before, so the sibling/anchor shade relationships are preserved.
 *  - `p(family, lightIndex, darkIndex)` (re-exported from basalt) picks the theme-shade pair;
 *    default indices (2 light / 3 dark) match basalt's own dark-mode-lift convention.
 *  - Emitted var names are IDENTICAL to argo's pre-migration `--vx-*` set (unprefixed series,
 *    `--vx-activity-*`, `--vx-usage-*`, `--vx-billing-*`, `--vx-outcome-*`) so `packages/charts`
 *    keeps resolving correctly until Phase 2 swaps chart imports over to `basalt-ui/charts`.
 *  - Values here are a mechanical carry-over, not a final visual pass — iterate live via the
 *    basalt-ui theme lab (`basalt-ui/theme-lab`) once Phase 2/3 land.
 */
import { BP, defineSeries, groupTokens, p, seriesTokens, type SeriesMap } from 'basalt-ui/tokens'

/** Per-metric series identity — see the module doctrine above for the family choices. */
const SERIES_MAP = defineSeries({
  // ── RECOVERY / SLEEP — sky (was Blueprint blue) ─────────────────────────
  hrv: p(BP.blue),
  hrvWeekly: p(BP.blue, 3, 4), // lighter sibling of hrv
  restingHr: p(BP.red), // CARDIO
  sleepDuration: p(BP.blue, 1, 2), // deep sky

  // Sleep stages — sky shades + neutral (deep = darkest, awake = neutral)
  deep: p(BP.blue, 0, 1),
  light: p(BP.blue, 3, 4),
  rem: p(BP.cerulean, 2, 3),
  awake: p(BP.gray, 1, 2),

  // EFFORT — the one meaningful escalation ramp (low forest → mid gold → high vermilion)
  intensityMin: p(BP.forest, 1, 2),
  vigorousMin: p(BP.vermilion),
  intensityWalking: p(BP.forest, 3, 4),
  intensityModerate: p(BP.gold),
  intensityVigorous: p(BP.vermilion),

  // MOVEMENT (sky) · AEROBIC (cerulean) · ENERGY (orange)
  steps: p(BP.blue, 3, 4),
  calories: p(BP.orange),
  spo2: p(BP.cerulean),
  respiration: p(BP.cerulean, 3, 4),
  vo2max: p(BP.gold),

  // Training load — warm band (acwr gold, acute light, chronic deep)
  acwr: p(BP.gold),
  acute: p(BP.orange, 3, 4),
  chronic: p(BP.orange, 1, 2),

  // ── Strength · per-lift (distinct set: sky / forest / vermilion / gold) ──
  benchPress: p(BP.blue),
  squat: p(BP.forest),
  deadlift: p(BP.vermilion),
  pullUps: p(BP.gold),

  // Interval timer — work/rest phase separation (the lead-in phase stays neutral)
  timerWork: p(BP.forest),
  timerRest: p(BP.cerulean),

  // ── Body composition · skinfold sites (distinct from the strength set above) ──
  skinfoldAbdominal: p(BP.cerulean),
  skinfoldSuprailiac: p(BP.gold),

  // ── WalkingPad · distinct per-metric set (sky anchor + warm accents) ────
  walkingDistance: p(BP.blue), // anchor
  walkingPace: p(BP.gold),
  walkingSteps: p(BP.forest),
  walkingKcal: p(BP.orange),
  walkingDuration: p(BP.sepia),

  // ── Astro window · the sky itself ───────────────────────────────────────
  // The galactic core is the anchor metric of the page, so it takes the sky
  // hue. The moon is its antagonist, not a sibling — gold, so the two curves
  // never read as one family on the same axis.
  coreAltitude: p(BP.blue),
  moonAltitude: p(BP.gold),
  // Cloud layers are a severity ramp, not three peers: at a 13° target it is
  // low cloud that ends the night, mid that threatens it and high that only
  // costs contrast. Red → orange → sepia encodes that order at a glance.
  cloudLow: p(BP.red),
  cloudMid: p(BP.orange),
  cloudHigh: p(BP.sepia),
  transparencyBand: p(BP.cerulean),
} satisfies SeriesMap)

/** Garmin activities — per-type identity. */
const ACTIVITY_MAP = defineSeries({
  gym: p(BP.red),
  cycling: p(BP.blue),
  tennis: p(BP.gold),
  running: p(BP.forest),
  hiking: p(BP.orange),
  surfing: p(BP.cerulean),
  other: p(BP.gray),
} satisfies SeriesMap)

/** Usage tracker — source identity. */
const USAGE_SOURCE_MAP = defineSeries({
  claudeCode: p(BP.blue),
  litellm: p(BP.cerulean),
  sideclaw: p(BP.gold),
  hermesAgent: p(BP.red),
  audioProxy: p(BP.forest),
  feuer: p(BP.vermilion),
  opencode: p(BP.orange),
  // The two standalone VPS gateways. Without their own identity both fell to
  // `other`, so they rendered as the same grey as each other and as every
  // genuinely unknown source.
  researchGateway: p(BP.violet),
  imageGen: p(BP.turquoise),
  other: p(BP.gray),
} satisfies SeriesMap)

/** Usage tracker — billing identity. */
const USAGE_BILLING_MAP = defineSeries({
  max: p(BP.gold),
  iu: p(BP.blue),
  unknown: p(BP.gray),
} satisfies SeriesMap)

/** Usage tracker — outcome identity. */
const USAGE_OUTCOME_MAP = defineSeries({
  ok: p(BP.forest),
  error: p(BP.red),
  cancelled: p(BP.gold),
} satisfies SeriesMap)

export const SERIES = seriesTokens(SERIES_MAP)
export const ACTIVITY = groupTokens('activity', ACTIVITY_MAP)
export const USAGE_SOURCE = groupTokens('usage', USAGE_SOURCE_MAP)
export const USAGE_BILLING = groupTokens('billing', USAGE_BILLING_MAP)
export const USAGE_OUTCOME = groupTokens('outcome', USAGE_OUTCOME_MAP)

/**
 * `paletteOptions.groups` shape for `BasaltProvider` — appends argo's domain series on top of
 * basalt's framework primitives. Prefixes match the `--vx-*` names above exactly.
 */
export const argoPaletteGroups: Record<string, SeriesMap> = {
  '': SERIES_MAP,
  'activity-': ACTIVITY_MAP,
  'usage-': USAGE_SOURCE_MAP,
  'billing-': USAGE_BILLING_MAP,
  'outcome-': USAGE_OUTCOME_MAP,
}

/**
 * `optimalZone` (`packages/charts/src/tokens.ts` → `VX.series.optimalZone`) is not a per-theme
 * hex pair like the series above — it was always a DERIVED tint of `--vx-good-solid` (see the old
 * `packages/charts/src/theme-vars.ts` DERIVED block), so it can't live in `defineSeries`. Carried
 * forward via `paletteOptions.derived` so the var name and formula stay identical.
 */
export const ARGO_DERIVED = [
  '--vx-optimalZone: color-mix(in srgb, var(--vx-good-solid) 10%, transparent);',
]

declare module 'basalt-ui' {
  interface BasaltRegister {
    series: typeof SERIES_MAP
  }
}
