import type { Map as MapLibreMap, Marker } from 'maplibre-gl'

/** Axis-aligned screen rectangle in canvas pixels. */
export type Box = { x0: number; y0: number; x1: number; y1: number }

/** Distance from a dot's centre to the near edge of its name. */
const LABEL_GAP = 12
/** Keep a name this far inside the canvas edge so it is never clipped by the card. */
const EDGE_INSET = 4
/** Half the dot's hit box (the selected dot is 16 px; the rest are 12). */
const DOT_RADIUS = 8

export const boxesOverlap = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

export type LabelPlacement = { offset: [number, number]; box: Box }

/**
 * The four places a name can sit around its dot, in preference order: right, left, above, below.
 * The label marker is centre-anchored, so each is an offset from the dot's own screen point.
 */
export function labelCandidates(
  point: { x: number; y: number },
  size: { width: number; height: number },
): LabelPlacement[] {
  const halfW = size.width / 2
  const halfH = size.height / 2
  const offsets: [number, number][] = [
    [halfW + LABEL_GAP, 0],
    [-(halfW + LABEL_GAP), 0],
    [0, -(halfH + LABEL_GAP)],
    [0, halfH + LABEL_GAP],
  ]
  return offsets.map(([dx, dy]) => ({
    offset: [dx, dy],
    box: {
      x0: point.x + dx - halfW,
      y0: point.y + dy - halfH,
      x1: point.x + dx + halfW,
      y1: point.y + dy + halfH,
    },
  }))
}

/** The first candidate that is inside the canvas and not blocked; `null` when none is. */
export function pickPlacement({
  candidates,
  canvas,
  isBlocked,
}: {
  candidates: readonly LabelPlacement[]
  canvas: { width: number; height: number }
  isBlocked: (box: Box) => boolean
}): LabelPlacement | null {
  return (
    candidates.find(
      ({ box }) =>
        box.x0 >= EDGE_INSET &&
        box.y0 >= EDGE_INSET &&
        box.x1 <= canvas.width - EDGE_INSET &&
        box.y1 <= canvas.height - EDGE_INSET &&
        !isBlocked(box),
    ) ?? null
  )
}

export type SiteLabel = {
  /** A centre-anchored marker whose element is the name. */
  marker: Marker
  element: HTMLElement
  lngLat: [number, number]
  selected: boolean
}

/**
 * Seats every site's name next to its dot without covering anything: another dot, an
 * already-placed name, or a basemap label the map actually drew (`queryRenderedFeatures` over the
 * text layers answers that after MapLibre's own collision pass). The selected site goes first and
 * is always shown, falling back to the right-hand slot when every slot is taken; any other name
 * with no free slot is hidden at this zoom (its dot keeps the accessible name) and returns when
 * the reader zooms in.
 */
export function placeSiteLabels({
  map,
  labels,
  textLayers,
}: {
  map: MapLibreMap
  labels: readonly SiteLabel[]
  /** The basemap's text layer ids (`basemapLabelLayerIds`), the text the names must not cover. */
  textLayers: readonly string[]
}): void {
  const canvas = map.getCanvas()
  const size = { width: canvas.clientWidth, height: canvas.clientHeight }
  const hitsBasemapLabel = ({ x0, y0, x1, y1 }: Box): boolean =>
    textLayers.length > 0 &&
    map.queryRenderedFeatures(
      [
        [x0, y0],
        [x1, y1],
      ],
      { layers: [...textLayers] },
    ).length > 0

  const points = labels.map((label) => map.project(label.lngLat))
  const taken: Box[] = points.map(({ x, y }) => ({
    x0: x - DOT_RADIUS,
    y0: y - DOT_RADIUS,
    x1: x + DOT_RADIUS,
    y1: y + DOT_RADIUS,
  }))

  const order = labels
    .map((_, index) => index)
    .toSorted((a, b) => +labels[b]!.selected - +labels[a]!.selected)
  for (const index of order) {
    const label = labels[index]!
    const candidates = labelCandidates(points[index]!, {
      width: label.element.offsetWidth,
      height: label.element.offsetHeight,
    })
    const placement =
      pickPlacement({
        candidates,
        canvas: size,
        isBlocked: (box) =>
          taken.some((other) => boxesOverlap(box, other)) || hitsBasemapLabel(box),
      }) ?? (label.selected ? candidates[0]! : null)

    // `visibility`, not `display`: a hidden element measures 0 × 0 and could never be placed again.
    label.element.style.visibility = placement === null ? 'hidden' : 'visible'
    if (placement === null) continue
    label.marker.setOffset(placement.offset)
    taken.push(placement.box)
  }
}
