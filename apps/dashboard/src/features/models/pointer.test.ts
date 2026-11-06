import { describe, expect, it } from 'bun:test'
import { captureRadius, nearestPoint, pointerInPlot, toPlotPixel } from './pointer'

describe('toPlotPixel', () => {
  it('maps the domains onto the plot, y up', () => {
    const size = { width: 400, height: 200 }
    expect(toPlotPixel({ x: 1, y: 10 }, [0, 2], [0, 20], size)).toEqual({ x: 200, y: 100 })
    expect(toPlotPixel({ x: 0, y: 20 }, [0, 2], [0, 20], size)).toEqual({ x: 0, y: 0 })
    expect(toPlotPixel({ x: 2, y: 0 }, [0, 2], [0, 20], size)).toEqual({ x: 400, y: 200 })
  })
})

describe('pointerInPlot', () => {
  const plot = { x: 20, y: 4, width: 400, height: 300 }
  it('is relative to the plot origin', () => {
    expect(pointerInPlot({ x: 120, y: 54 }, plot, 0)).toEqual({ x: 100, y: 50 })
  })
  it('allows a margin round the plot and nothing beyond', () => {
    expect(pointerInPlot({ x: 10, y: 4 }, plot, 16)).toEqual({ x: -10, y: 0 })
    expect(pointerInPlot({ x: 0, y: 4 }, plot, 16)).toBeNull()
    expect(pointerInPlot({ x: 100, y: 330 }, plot, 16)).toBeNull()
  })
})

describe('nearestPoint', () => {
  const points = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 100, y: 112 },
    { id: 'c', x: 160, y: 100 },
  ]
  it('picks the nearest in two dimensions, not the nearest x', () => {
    // Same x as a and b; closer to b in y.
    expect(nearestPoint({ x: 100, y: 108 }, points, 16)?.id).toBe('b')
    expect(nearestPoint({ x: 100, y: 103 }, points, 16)?.id).toBe('a')
  })
  it('returns null beyond the capture radius', () => {
    expect(nearestPoint({ x: 130, y: 100 }, points, 16)).toBeNull()
    expect(nearestPoint({ x: 130, y: 100 }, points, 30)?.id).toBe('a')
  })
  it('takes the first of two equally near points', () => {
    expect(nearestPoint({ x: 100, y: 106 }, points, 16)?.id).toBe('a')
  })
  it('has a wider capture radius for a finger', () => {
    expect(captureRadius('touch')).toBe(24)
    expect(captureRadius('pen')).toBe(24)
    expect(captureRadius('mouse')).toBe(16)
  })
})
