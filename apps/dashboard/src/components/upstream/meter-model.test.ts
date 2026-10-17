import { describe, expect, test } from 'bun:test'
import {
  findHoldingZone,
  layoutSegments,
  modelBar,
  normalizeSegments,
  segmentReading,
  spanOf,
} from './meter-model'

const fmt = (n: number) => String(n)
const ZONES = [
  { from: 0, to: 300, label: 'Low' },
  { from: 300, to: 750, label: 'Optimal' },
  { from: 750, to: 1000, label: 'High' },
]

describe('findHoldingZone', () => {
  test('from is inclusive, to is exclusive', () => {
    expect(findHoldingZone(ZONES, 300)?.label).toBe('Optimal')
    expect(findHoldingZone(ZONES, 299)?.label).toBe('Low')
  })
  test('the last zone owns its end', () => {
    expect(findHoldingZone(ZONES, 1000)?.label).toBe('High')
  })
  test('below the first and past the last zone hold nothing', () => {
    expect(findHoldingZone([{ from: 100, to: 200, label: 'x' }], 50)).toBeUndefined()
    expect(findHoldingZone(ZONES, 1001)).toBeUndefined()
  })
})

describe('normalizeSegments', () => {
  test('negative and non-finite amounts become 0, in one place', () => {
    const out = normalizeSegments([
      { value: -5, label: 'a' },
      { value: Number.NaN, label: 'b' },
      { value: 7, label: 'c' },
    ])
    expect(out.map((s) => s.value)).toEqual([0, 0, 7])
    expect(segmentReading(out, 10)).toBe(17)
  })
})

describe('layoutSegments', () => {
  test('parts accumulate and stop at the track end', () => {
    const parts = layoutSegments(
      [
        { value: 70, label: 'a' },
        { value: 70, label: 'b' },
      ],
      100,
    )
    expect(parts.map((p) => [p.start, p.size])).toEqual([
      [0, 0.7],
      [0.7, 0.30000000000000004],
    ])
  })
  test('a forecast part ignores its colour', () => {
    const [part] = layoutSegments([{ value: 10, label: 'f', forecast: true, color: 'red' }], 100)
    expect(part?.color).toBeUndefined()
  })
})

describe('spanOf', () => {
  test('is pure: max <= min is the fallback span, flagged invalid', () => {
    expect(spanOf(5, 5)).toEqual({ span: 1, valid: false })
  })
  test('a valid track is its width', () => {
    expect(spanOf(10, 50)).toEqual({ span: 40, valid: true })
  })
})

describe('modelBar', () => {
  const base = { min: 0, max: 100, format: fmt }
  test('captions: zone + reading, overage past a target', () => {
    expect(modelBar({ ...base, reading: 612, max: 1000, zones: ZONES }).startText).toBe(
      'Optimal · 612',
    )
    expect(modelBar({ ...base, reading: 120, target: 100 }).endText).toBe('Target 100 · 20 over')
  })
  test('a forecast in first position still has a caption but no boundary tick', () => {
    const m = modelBar({
      ...base,
      reading: 50,
      segments: [{ value: 50, label: 'Plan', forecast: true }],
    })
    expect(m.forecastText).toBe('Forecast: Plan 50')
    expect(m.boundaryPct).toBeUndefined()
  })
  test('two forecasts are both named', () => {
    const m = modelBar({
      ...base,
      reading: 90,
      segments: [
        { value: 40, label: 'Done' },
        { value: 30, label: 'A', forecast: true },
        { value: 20, label: 'B', forecast: true },
      ],
    })
    expect(m.forecastText).toBe('Forecast: A 30, B 20')
    expect(m.boundaryPct).toBe(40)
  })
  test('non-zero min shifts target and marker', () => {
    const m = modelBar({ ...base, min: 100, max: 200, reading: 150, target: 125, zones: ZONES })
    expect(m.markerPct).toBe(50)
    expect(m.targetPct).toBe(25)
  })
})
