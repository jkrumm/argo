/**
 * Pointer maths of a scatter, pure. `CartesianChart` exposes no scales, so the overlay works from what
 * the page already knows: the x and y domains it hands the chart, and the plot rectangle the chart
 * draws (measured from its clip rect). A pointer is mapped to plot pixels, each point to the pixel
 * the same domains give it, and the nearest point within the capture radius wins.
 */
export interface PlotRect {
  /** Left and top of the plot inside the chart's coordinate space, px. */
  x: number
  y: number
  width: number
  height: number
}

/** The capture radius, px: a fingertip is wider than a mouse pointer. */
export const CAPTURE_RADIUS = { touch: 24, mouse: 16 } as const

export const captureRadius = (pointerType: string): number =>
  pointerType === 'touch' || pointerType === 'pen' ? CAPTURE_RADIUS.touch : CAPTURE_RADIUS.mouse

/** Where a data point sits in plot pixels (origin top left), on linear domains. */
export function toPlotPixel(
  point: { x: number; y: number },
  xDomain: readonly [number, number],
  yDomain: readonly [number, number],
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((point.x - xDomain[0]) / (xDomain[1] - xDomain[0])) * size.width,
    y: (1 - (point.y - yDomain[0]) / (yDomain[1] - yDomain[0])) * size.height,
  }
}

/** A pointer in chart coordinates as plot pixels, or null when it is outside the plot by more than `margin`. */
export function pointerInPlot(
  pointer: { x: number; y: number },
  plot: PlotRect,
  margin: number,
): { x: number; y: number } | null {
  const x = pointer.x - plot.x
  const y = pointer.y - plot.y
  if (x < -margin || y < -margin || x > plot.width + margin || y > plot.height + margin) return null
  return { x, y }
}

/** The candidate nearest to `at` in pixels within `radius`; the first of two equally near wins. */
export function nearestPoint<T extends { x: number; y: number }>(
  at: { x: number; y: number },
  candidates: readonly T[],
  radius: number,
): T | null {
  let best: T | null = null
  let bestDistance = radius * radius
  for (const candidate of candidates) {
    const distance = (candidate.x - at.x) ** 2 + (candidate.y - at.y) ** 2
    if (distance > bestDistance || (best !== null && distance === bestDistance)) continue
    best = candidate
    bestDistance = distance
  }
  return best
}
