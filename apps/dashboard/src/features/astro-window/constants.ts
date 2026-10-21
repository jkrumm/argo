/** Sky-brightness meter domain (mag/arcsec²) and the map legend's dark threshold. */
export const SKY_METER_MIN = 18
export const SKY_METER_MAX = 22
export const SKY_DARK_THRESHOLD = 21.6

/** The sun's depth below the horizon at which a night counts as astronomically dark. */
export const ASTRONOMICAL_DARK_SUN_DEG = 18

export const METRIC_TOOLTIPS = {
  nightTimeline: `Altitude is degrees above the horizon. Astronomical dark is when the sun is more than ${ASTRONOMICAL_DARK_SUN_DEG}° below it. The shooting window is the stretch of dark when the core clears its gate; the moon is judged separately, as its own gate.`,
  cloudLayers:
    'Cloud cover is the share of sky covered, per layer. Cloud never rules a night out: each layer is graded in the score, low cloud weighing most and ruining a night at much less cover than high cloud (cirrus), which only costs contrast.',
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
 * viewport guess. The shell is a column (`app-main.module.css`): the header offset, the page-bar
 * band, then `AppShell.Main` as the scrollport, with `margin-bottom` of the footer offset plus
 * `env(safe-area-inset-bottom)` and a block padding of `--basalt-main-pad-block` (inherited by
 * this card) on each side. Subtracting exactly those hands the map the whole content box, on
 * desktop (no footer, no inset) and on a phone (tab bar plus home-indicator inset) alike.
 *
 * The page-bar band is `--basalt-page-bar-h` (its CONTENT box, published on `documentElement`)
 * plus its own 1px `border-bottom`, which the var never counts. `var(--basalt-page-bar-h, -1px)
 * + 1px` adds that pixel only while a band exists and nets to 0px without one.
 *
 * `h="100%"` cannot be used instead: `AppShell.Main` sizes itself with `flex` and `min-height`,
 * so a percentage height on a child does not resolve against the scrollport.
 */
export const MAP_FULL_BLEED_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0px) - var(--app-shell-footer-offset, 0px) - env(safe-area-inset-bottom, 0px) - (var(--basalt-page-bar-h, -1px) + 1px) - 2 * var(--basalt-main-pad-block, 0px))'

/** Floor for a short viewport (a landscape phone) — below this the map stops being usable. */
export const MAP_MIN_HEIGHT = 420

/** Upper end of the core-altitude meters; the core never tops ~30° at the site latitudes, so a small gap stays visible. */
export const CORE_METER_MAX_DEG = 30

/** Pixels of slack when deciding a strip cell is off-screen, so sub-pixel rounding never counts a fully visible cell. */
export const OFFSCREEN_TOLERANCE_PX = 1

/** The shortest bar the strip draws for a non-zero value, so a small shortfall or window stays visible. */
export const MIN_BAR_SHARE = 0.06

/** The Core reading's unit, shared by the Tonight Core cell and the Forecast panorama header. */
export const CORE_UNIT = 'nearest its gate'
