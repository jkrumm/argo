/**
 * Greedy label placement for a scatter, in plot pixels. Each label tries the right of its dot, then the
 * left, above and below; the first spot that stays inside the plot and clears the labels already
 * placed and every dot wins. A label with no free spot is left out (its tooltip still names it), which
 * is the whole point: the persistent labels are the routed and frontier points, never a pile.
 */
export interface LabelCandidate {
  id: string
  text: string
  /** Dot centre, px. */
  x: number
  y: number
  /** Dot radius, px. */
  r: number
}

export type LabelSide = 'right' | 'left' | 'above' | 'below'

export interface PlacedLabel {
  id: string
  text: string
  side: LabelSide
  /** Text anchor and offsets from the dot centre, in px, as the text mark takes them. */
  anchor: 'start' | 'end' | 'middle'
  dx: number
  dy: number
}

export interface LabelObstacle {
  x: number
  y: number
  r: number
}

export interface LabelLayout {
  width: number
  height: number
  /** Estimated glyph width and line height, px. */
  charWidth: number
  lineHeight: number
}

type Rect = { left: number; right: number; top: number; bottom: number }

const GAP = 4
const SIDES: readonly LabelSide[] = ['right', 'left', 'above', 'below']

function placement(
  c: LabelCandidate,
  side: LabelSide,
  layout: LabelLayout,
): { rect: Rect; anchor: PlacedLabel['anchor']; dx: number; dy: number } {
  const w = c.text.length * layout.charWidth
  const h = layout.lineHeight
  // The text baseline sits `h * 0.3` under the vertical middle of the line.
  const middle = (top: number) => ({ top, bottom: top + h })
  switch (side) {
    case 'right':
      return {
        rect: { left: c.x + c.r + GAP, right: c.x + c.r + GAP + w, ...middle(c.y - h / 2) },
        anchor: 'start',
        dx: c.r + GAP,
        dy: h * 0.3,
      }
    case 'left':
      return {
        rect: { left: c.x - c.r - GAP - w, right: c.x - c.r - GAP, ...middle(c.y - h / 2) },
        anchor: 'end',
        dx: -(c.r + GAP),
        dy: h * 0.3,
      }
    case 'above':
      return {
        rect: { left: c.x - w / 2, right: c.x + w / 2, ...middle(c.y - c.r - GAP - h) },
        anchor: 'middle',
        dx: 0,
        dy: -(c.r + GAP + h * 0.2),
      }
    case 'below':
      return {
        rect: { left: c.x - w / 2, right: c.x + w / 2, ...middle(c.y + c.r + GAP) },
        anchor: 'middle',
        dx: 0,
        dy: c.r + GAP + h * 0.8,
      }
  }
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

function hitsDot(rect: Rect, dot: LabelObstacle): boolean {
  const nx = Math.max(rect.left, Math.min(dot.x, rect.right))
  const ny = Math.max(rect.top, Math.min(dot.y, rect.bottom))
  return (nx - dot.x) ** 2 + (ny - dot.y) ** 2 < dot.r ** 2
}

/** `candidates` in priority order; the result keeps that order and omits what found no room. */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  obstacles: readonly LabelObstacle[],
  layout: LabelLayout,
): PlacedLabel[] {
  const placed: PlacedLabel[] = []
  const taken: Rect[] = []
  const bounds: Rect = { left: 0, right: layout.width, top: 0, bottom: layout.height }
  for (const c of candidates) {
    for (const side of SIDES) {
      const spot = placement(c, side, layout)
      const inside =
        spot.rect.left >= bounds.left &&
        spot.rect.right <= bounds.right &&
        spot.rect.top >= bounds.top &&
        spot.rect.bottom <= bounds.bottom
      if (!inside) continue
      if (taken.some((t) => overlaps(t, spot.rect))) continue
      if (obstacles.some((o) => hitsDot(spot.rect, o))) continue
      taken.push(spot.rect)
      placed.push({ id: c.id, text: c.text, side, anchor: spot.anchor, dx: spot.dx, dy: spot.dy })
      break
    }
  }
  return placed
}
