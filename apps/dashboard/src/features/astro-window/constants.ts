/** Sky-brightness meter domain (mag/arcsec²) and the map legend's dark threshold. */
export const SKY_METER_MIN = 18
export const SKY_METER_MAX = 22
export const SKY_DARK_THRESHOLD = 21.6

/** The sun's depth below the horizon at which a night counts as astronomically dark. */
export const ASTRONOMICAL_DARK_SUN_DEG = 18

export const METRIC_TOOLTIPS = {
  nightTimeline: `Altitude is degrees above the horizon. Astronomical dark is when the sun is more than ${ASTRONOMICAL_DARK_SUN_DEG}° below it. The shooting window is the stretch of dark when the core clears its gate; the moon is judged separately, as its own gate.`,
  cloudLayers:
    'Cloud cover is the share of sky covered, per layer. It is a weighted factor in the score, not a gate: heavy cloud drops a night to poor. Low cloud (under about 2 km) blocks the sky outright; high cloud (cirrus) only costs contrast.',
  skyPanorama: `Azimuth is the compass bearing, degrees clockwise from north. The skyline is the measured terrain; the gate is the higher of the 8° atmospheric floor and the skyline plus the framing margin. Skyglow is artificial sky brightness in mag/arcsec²; dark sky is ${SKY_DARK_THRESHOLD} or higher.`,
  monthlyBudget:
    'Hours per calendar month in which the core is above the gate, at this site, counted three ways: above the flat 8° floor, above the floor and the measured skyline, and with the moon also counted down when it sits behind that skyline. Weather is not included.',
} as const

export const CHART_HEIGHT = 260

/** Slightly taller than CHART_HEIGHT: the panorama carries the skyline, the gate and three tracks on one pair of axes. */
export const PANORAMA_HEIGHT = 320

/** Fixed height so the map and the night-facts panel line up exactly. */
export const SIDE_PANEL_HEIGHT = 620

/**
 * Full-bleed height for the Map tab, expressed in BasaltShell's OWN variables rather than a raw
 * viewport guess. The shell's `AppShell` is `h="100dvh"` and `AppShell.Main` pads by the header
 * and footer offsets plus `--app-shell-padding` on each side — subtracting exactly those hands
 * the map the whole content box and keeps tracking it when the header height changes or the
 * mobile footer appears.
 *
 * `h="100%"` cannot be used instead: `AppShell.Main` sizes itself with `min-height`, so a
 * percentage height on a child resolves against `auto` and collapses to nothing.
 */
export const MAP_FULL_BLEED_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0px) - var(--app-shell-footer-offset, 0px) - 2 * var(--app-shell-padding, 0px))'

/** Floor for a short viewport (a landscape phone) — below this the map stops being usable. */
export const MAP_MIN_HEIGHT = 420

/** Upper end of the core-altitude meters; the core never tops ~30° at the site latitudes, so a small gap stays visible. */
export const CORE_METER_MAX_DEG = 30

/** Pixels of slack when deciding a strip cell is off-screen, so sub-pixel rounding never counts a fully visible cell. */
export const OFFSCREEN_TOLERANCE_PX = 1

/** The shortest bar the strip draws for a non-zero value, so a small shortfall or window stays visible. */
export const MIN_BAR_SHARE = 0.06
