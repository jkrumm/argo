export const NIGHTS_OPTIONS: { value: string; label: string }[] = [
  { value: '5', label: '5N' },
  { value: '10', label: '10N' },
  { value: '14', label: '14N' },
]

export const METRIC_TOOLTIPS = {
  nightTimeline:
    'Galactic core, moon and sun altitude across the night. Shaded bands mark astronomical dark (faint) and the recommended shooting window (stronger, with a top rule). The sun line explains where the dark bands come from.',
  cloudLayers:
    'Low/mid/high cloud cover (%) across the same night, same time axis as the timeline above. Low cloud ends a night outright; high cloud only costs contrast.',
  skyPanorama:
    "Azimuth × altitude panorama for tonight: the measured terrain skyline, the artificial skyglow rose behind it, and the tracks the sun, moon and galactic core walk across it. Scrub the slider to see where each one sits at a given time — it opens on the core's highest point while astronomically dark.",
  monthlyBudget:
    'Usable galactic-core hours per calendar month at this site, under three progressively honest gates: the flat atmospheric floor, the same floor plus the measured terrain skyline, and terrain with the moon also counted down when it sits behind that skyline. Weather-free and deterministic — answers whether the SITE is worth the drive, not whether tonight is.',
} as const

export const CHART_HEIGHT = 260

/** Taller than CHART_HEIGHT — the panorama's altitude domain (−4° to 52°) needs the extra room a
 * single night's timeline doesn't. */
export const PANORAMA_HEIGHT = 420

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
