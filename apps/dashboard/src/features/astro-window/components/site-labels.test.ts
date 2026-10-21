import { describe, expect, test } from 'bun:test'
import { boxesOverlap, labelCandidates, pickPlacement } from './site-labels'

const size = { width: 60, height: 14 }
const canvas = { width: 400, height: 300 }
const point = { x: 200, y: 150 }

describe('labelCandidates', () => {
  test('orders right, left, above, below around the dot', () => {
    const [right, left, above, below] = labelCandidates(point, size)
    expect(right!.box.x0).toBeGreaterThan(point.x)
    expect(left!.box.x1).toBeLessThan(point.x)
    expect(above!.box.y1).toBeLessThan(point.y)
    expect(below!.box.y0).toBeGreaterThan(point.y)
  })
})

describe('pickPlacement', () => {
  test('takes the right-hand slot when nothing is in the way', () => {
    const placement = pickPlacement({
      candidates: labelCandidates(point, size),
      canvas,
      isBlocked: () => false,
    })
    expect(placement?.offset[0]).toBeGreaterThan(0)
  })

  test('moves to the next slot when the first is blocked', () => {
    const candidates = labelCandidates(point, size)
    const placement = pickPlacement({
      candidates,
      canvas,
      isBlocked: (box) => boxesOverlap(box, candidates[0]!.box),
    })
    expect(placement).toBe(candidates[1]!)
  })

  test('skips a slot that leaves the canvas', () => {
    const edge = { x: 390, y: 150 }
    const candidates = labelCandidates(edge, size)
    const placement = pickPlacement({ candidates, canvas, isBlocked: () => false })
    expect(placement).toBe(candidates[1]!)
  })

  test('returns null when every slot is blocked', () => {
    expect(
      pickPlacement({ candidates: labelCandidates(point, size), canvas, isBlocked: () => true }),
    ).toBeNull()
  })
})

describe('boxesOverlap', () => {
  test('touching edges do not overlap', () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 }
    expect(boxesOverlap(a, { x0: 10, y0: 0, x1: 20, y1: 10 })).toBe(false)
    expect(boxesOverlap(a, { x0: 9, y0: 0, x1: 20, y1: 10 })).toBe(true)
  })
})
