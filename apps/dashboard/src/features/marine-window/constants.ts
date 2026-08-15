export const DAYS_OPTIONS: { value: string; label: string }[] = [
  { value: '3', label: '3D' },
  { value: '5', label: '5D' },
  { value: '7', label: '7D' },
]

export const METRIC_TOOLTIPS = {
  swellTimeline:
    'Swell height (left axis) and swell period (right axis) across the day. The shaded band marks the recommended session window — the longest run of ungated daylight hours.',
  windChart:
    'Wind speed across the same day, same time axis as the chart above. The strip along the baseline classifies each hour offshore, cross-shore or onshore — offshore holds a wave face up, onshore knocks it into mush.',
} as const

export const CHART_HEIGHT = 260

/** Fixed height so the map and the day-facts panel line up exactly. */
export const SIDE_PANEL_HEIGHT = 620
