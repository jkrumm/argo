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
} as const

export const CHART_HEIGHT = 260

/** Fixed height so the map and the night-facts panel line up exactly. */
export const SIDE_PANEL_HEIGHT = 620
