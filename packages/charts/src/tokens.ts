/**
 * Visx chart tokens — single source of truth for colors, sizing and theme-dependent values.
 *
 * Colors are now CSS custom properties (see palette.ts → theme-vars.ts). They resolve per
 * Mantine color scheme automatically, so VX.* works in components AND in non-component files
 * (constants.ts, formulas.ts). Never reference raw hex in chart files — use VX.* / useVxTheme().
 */

export const VX = {
  // Non-color sizing constants
  lineWidth: 2.5,
  line2Width: 2,
  axisFont: 11,
  dotR: 5,

  // Secondary-line color (back-compat alias; now theme-aware via --vx-line2)
  line2Dark: 'var(--vx-line2)',

  // Semantic fills — consistent opacity across all charts
  good: 'var(--vx-good)',
  goodSoft: 'var(--vx-goodSoft)',
  bad: 'var(--vx-bad)',
  warn: 'var(--vx-warn)',
  goodSolid: 'var(--vx-goodSolid)',
  badSolid: 'var(--vx-badSolid)',
  warnSolid: 'var(--vx-warnSolid)',

  // Reference/dashed lines for thresholds
  goodRef: 'var(--vx-goodRef)',
  badRef: 'var(--vx-badRef)',
  warnRef: 'var(--vx-warnRef)',

  // Neutral primary line/text color — the default for single-series, no-signal marks
  // ("white/gray per theme"). Same value as useVxTheme().line.
  line: 'var(--vx-line)',

  // Grid, hover, legend
  grid: 'var(--vx-grid)',
  crosshair: 'var(--vx-crosshair)',
  dotStroke: 'var(--vx-dotStroke)',
  legendText: 'var(--vx-legendText)',

  // Base neutral for hairlines / muted text / overlays — apply opacity via alpha()
  neutral: 'var(--vx-neutral)',

  // App surfaces (cards, borders) — shared with the Mantine chrome
  surface: {
    bg: 'var(--vx-surface-bg)',
    panel: 'var(--vx-surface-panel)',
    elevated: 'var(--vx-surface-elevated)',
    border: 'var(--vx-surface-border)',
  },
  shadowCard: 'var(--vx-shadowCard)',

  // Score / zone status scale (excellent → poor)
  status: {
    excellent: 'var(--vx-status-excellent)',
    good: 'var(--vx-status-good)',
    warn: 'var(--vx-status-warn)',
    bad: 'var(--vx-status-bad)',
    neutral: 'var(--vx-status-neutral)',
  },

  // Per-metric series colors — stable hue identity, shade resolved per theme.
  series: {
    // Sleep stages
    deep: 'var(--vx-deep)',
    rem: 'var(--vx-rem)',
    light: 'var(--vx-light)',
    awake: 'var(--vx-awake)',

    // Metrics
    sleepDuration: 'var(--vx-sleepDuration)',
    hrv: 'var(--vx-hrv)',
    hrvWeekly: 'var(--vx-hrvWeekly)',
    restingHr: 'var(--vx-restingHr)',
    steps: 'var(--vx-steps)',
    intensityMin: 'var(--vx-intensityMin)',
    vigorousMin: 'var(--vx-vigorousMin)',
    intensityWalking: 'var(--vx-intensityWalking)',
    intensityModerate: 'var(--vx-intensityModerate)',
    intensityVigorous: 'var(--vx-intensityVigorous)',
    calories: 'var(--vx-calories)',
    spo2: 'var(--vx-spo2)',
    respiration: 'var(--vx-respiration)',
    vo2max: 'var(--vx-vo2max)',
    acwr: 'var(--vx-acwr)',
    acute: 'var(--vx-acute)',
    chronic: 'var(--vx-chronic)',
    optimalZone: 'var(--vx-optimalZone)',

    // Strength tracker — per-lift stable identity
    benchPress: 'var(--vx-benchPress)',
    squat: 'var(--vx-squat)',
    deadlift: 'var(--vx-deadlift)',
    pullUps: 'var(--vx-pullUps)',

    // Body composition — skinfold caliper sites
    skinfoldAbdominal: 'var(--vx-skinfoldAbdominal)',
    skinfoldSuprailiac: 'var(--vx-skinfoldSuprailiac)',

    // WalkingPad — per-metric stable identity (distance is the anchor)
    walkingDistance: 'var(--vx-walkingDistance)',
    walkingPace: 'var(--vx-walkingPace)',
    walkingSteps: 'var(--vx-walkingSteps)',
    walkingKcal: 'var(--vx-walkingKcal)',
    walkingDuration: 'var(--vx-walkingDuration)',

    // Garmin activities — per-type stable identity (gym = red anchor)
    activity: {
      gym: 'var(--vx-activity-gym)',
      cycling: 'var(--vx-activity-cycling)',
      tennis: 'var(--vx-activity-tennis)',
      running: 'var(--vx-activity-running)',
      hiking: 'var(--vx-activity-hiking)',
      surfing: 'var(--vx-activity-surfing)',
      other: 'var(--vx-activity-other)',
    },

    // Usage tracker — source identity
    usageSource: {
      claudeCode: 'var(--vx-usage-claudeCode)',
      litellm: 'var(--vx-usage-litellm)',
      sideclaw: 'var(--vx-usage-sideclaw)',
      hermesAgent: 'var(--vx-usage-hermesAgent)',
      audioProxy: 'var(--vx-usage-audioProxy)',
      feuer: 'var(--vx-usage-feuer)',
      opencode: 'var(--vx-usage-opencode)',
      other: 'var(--vx-usage-other)',
    },

    // Usage tracker — billing identity
    usageBilling: {
      max: 'var(--vx-billing-max)',
      iu: 'var(--vx-billing-iu)',
      unknown: 'var(--vx-billing-unknown)',
    },

    // Usage tracker — outcome identity
    usageOutcome: {
      ok: 'var(--vx-outcome-ok)',
      error: 'var(--vx-outcome-error)',
      cancelled: 'var(--vx-outcome-cancelled)',
    },
  },

  // Shared sizing
  margin: { top: 12, right: 16, bottom: 30, left: 44 },
  minPxPerTick: 55,
} as const
