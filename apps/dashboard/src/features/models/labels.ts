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
  /** A required label is never dropped: it takes any free spot, then any spot clear of other labels, then the nearest one. */
  required?: boolean
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
  lift = 0,
): { rect: Rect; anchor: PlacedLabel['anchor']; dx: number; dy: number } {
  const w = c.text.length * layout.charWidth
  const h = layout.lineHeight
  // The text baseline sits `h * 0.3` under the vertical middle of the line.
  const middle = (top: number) => ({ top: top + lift, bottom: top + h + lift })
  switch (side) {
    case 'right':
      return {
        rect: { left: c.x + c.r + GAP, right: c.x + c.r + GAP + w, ...middle(c.y - h / 2) },
        anchor: 'start',
        dx: c.r + GAP,
        dy: h * 0.3 + lift,
      }
    case 'left':
      return {
        rect: { left: c.x - c.r - GAP - w, right: c.x - c.r - GAP, ...middle(c.y - h / 2) },
        anchor: 'end',
        dx: -(c.r + GAP),
        dy: h * 0.3 + lift,
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

/** Spots tried for a required label that no dot-free side suits: further and further from the dot. */
const REACH = [0, 12, 24, 40, 60] as const

const inside = (rect: Rect, layout: LabelLayout): boolean =>
  rect.left >= 0 && rect.right <= layout.width && rect.top >= 0 && rect.bottom <= layout.height

/**
 * `candidates` in priority order, required ones first; the result omits only optional labels that
 * found no room. A required label ends clear of every other label whenever the plot has room for it,
 * and is pulled back inside the plot edge as a last resort.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  obstacles: readonly LabelObstacle[],
  layout: LabelLayout,
): PlacedLabel[] {
  const placed: PlacedLabel[] = []
  const taken: Rect[] = []
  const ordered = [
    ...candidates.filter((c) => c.required === true),
    ...candidates.filter((c) => c.required !== true),
  ]
  const accept = (c: LabelCandidate, side: LabelSide, spot: ReturnType<typeof placement>) => {
    taken.push(spot.rect)
    placed.push({ id: c.id, text: c.text, side, anchor: spot.anchor, dx: spot.dx, dy: spot.dy })
  }
  for (const c of ordered) {
    const free = (spot: ReturnType<typeof placement>, avoidDots: boolean): boolean =>
      inside(spot.rect, layout) &&
      !taken.some((t) => overlaps(t, spot.rect)) &&
      !(avoidDots && obstacles.some((o) => hitsDot(spot.rect, o)))
    let done = false
    for (const side of SIDES) {
      const spot = placement(c, side, layout)
      if (!free(spot, true)) continue
      accept(c, side, spot)
      done = true
      break
    }
    if (done || c.required !== true) continue
    // Further out, and a line up or down beside the dot: the text slides clear of a neighbour's label.
    const line = layout.lineHeight + 2
    const lifts = [0, -line, line, -2 * line, 2 * line, -3 * line, 3 * line]
    for (const reach of REACH) {
      for (const lift of lifts) {
        for (const side of SIDES) {
          if (lift !== 0 && (side === 'above' || side === 'below')) continue
          const spot = placement({ ...c, r: c.r + reach }, side, layout, lift)
          if (!free(spot, false)) continue
          accept(c, side, spot)
          done = true
          break
        }
        if (done) break
      }
      if (done) break
    }
    if (done) continue
    // No clear spot: the right of the dot, pulled back inside the plot edge.
    const spot = placement(c, 'right', layout)
    const shift = Math.min(0, layout.width - spot.rect.right)
    accept(c, 'right', { ...spot, dx: spot.dx + shift })
  }
  return placed.toSorted(
    (a, b) =>
      candidates.findIndex((c) => c.id === a.id) - candidates.findIndex((c) => c.id === b.id),
  )
}
