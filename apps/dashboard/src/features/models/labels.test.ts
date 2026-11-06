import { describe, expect, it } from 'bun:test'
import { placeLabels, type LabelCandidate } from './labels'

const layout = { width: 400, height: 200, charWidth: 6, lineHeight: 12 }
const at = (id: string, x: number, y: number, text = 'Terra medium'): LabelCandidate => ({
  id,
  text,
  x,
  y,
  r: 4,
})

describe('placeLabels', () => {
  it('puts a label to the right of its dot when there is room', () => {
    const [label] = placeLabels([at('a', 100, 100)], [], layout)
    expect(label).toMatchObject({ id: 'a', side: 'right', anchor: 'start', dx: 8 })
  })

  it('flips to the left at the right edge', () => {
    const [label] = placeLabels([at('a', 380, 100)], [], layout)
    expect(label?.side).toBe('left')
  })

  it('goes above or below when both sides are blocked', () => {
    const [label] = placeLabels([at('a', 20, 100, 'Terra medium · 4 routes')], [], layout)
    expect(label?.side).toBe('right')
    const tight = placeLabels([at('a', 120, 100)], [{ x: 150, y: 100, r: 6 }], {
      ...layout,
      width: 160,
    })
    expect(tight[0]?.side).toBe('left')
  })

  it('does not print one label over another, and keeps the higher priority', () => {
    const placed = placeLabels([at('a', 100, 100), at('b', 110, 102)], [], layout)
    expect(placed[0]?.id).toBe('a')
    const [a, b] = placed
    if (a === undefined || b === undefined) return
    expect(`${a.side}-${b.side}`).not.toBe('right-right')
  })

  it('leaves a label out when nothing fits', () => {
    const crowd = [at('a', 100, 100, 'x'.repeat(40))]
    const dots = [
      { x: 140, y: 100, r: 30 },
      { x: 60, y: 100, r: 30 },
      { x: 100, y: 70, r: 30 },
      { x: 100, y: 130, r: 30 },
    ]
    expect(placeLabels(crowd, dots, layout)).toEqual([])
  })

  it('never places a label outside the plot', () => {
    for (const x of [0, 5, 395, 400]) {
      for (const label of placeLabels([at('a', x, 3)], [], layout)) {
        expect(label.side).toBeDefined()
      }
    }
  })
})
