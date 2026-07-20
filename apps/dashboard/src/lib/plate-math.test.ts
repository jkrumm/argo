import { describe, it, expect } from 'bun:test'
import {
  decompose,
  totalFor,
  addPlate,
  removePlate,
  availableDenominations,
  type LoadingConfig,
  type PlateLoad,
} from './plate-math'

const REAL_STOCK: LoadingConfig = {
  mode: 'barbell',
  barWeight: 20,
  stock: [
    { weight_kg: 15, count: 4 },
    { weight_kg: 10, count: 6 },
    { weight_kg: 5, count: 4 },
    { weight_kg: 2.5, count: 4 },
    { weight_kg: 1.25, count: 2 },
    { weight_kg: 0.5, count: 4 },
  ],
}

describe('decompose — barbell mode with the real inventory', () => {
  it('finds the max achievable total (174.5) when the target exceeds all stock', () => {
    const result = decompose(1000, REAL_STOCK)

    expect(result.total).toBe(174.5)
    expect(result.exact).toBe(false)
    expect(result.reason).toBe('unreachable')
  })

  it('decomposes an odd per-side remainder exactly: 82.5 -> 15+15+1.25 per side', () => {
    const result = decompose(82.5, REAL_STOCK)

    expect(result.total).toBe(82.5)
    expect(result.exact).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.plates).toEqual([
      { weight_kg: 15, count: 2 },
      { weight_kg: 1.25, count: 1 },
    ])
  })

  it('an unreachable target (200kg) returns the max achievable with reason unreachable', () => {
    const result = decompose(200, REAL_STOCK)

    expect(result.exact).toBe(false)
    expect(result.reason).toBe('unreachable')
    expect(result.total).toBe(174.5)
  })
})

describe('decompose — exact search beats greedy', () => {
  it('prefers 6+5=11 over greedy 10 (leaves 1kg unusable)', () => {
    const config: LoadingConfig = {
      mode: 'barbell',
      barWeight: 20,
      stock: [
        { weight_kg: 10, count: 2 },
        { weight_kg: 6, count: 2 },
        { weight_kg: 5, count: 2 },
      ],
    }

    // per-side target = 11 (target 42 = 20 bar + 2*11)
    const result = decompose(42, config)

    expect(result.exact).toBe(true)
    expect(result.total).toBe(42)
    expect(result.plates).toEqual([
      { weight_kg: 6, count: 1 },
      { weight_kg: 5, count: 1 },
    ])
  })

  it('prefers fewer plates among equal totals: one 5 over two 2.5s', () => {
    const config: LoadingConfig = {
      mode: 'barbell',
      barWeight: 0,
      stock: [
        { weight_kg: 5, count: 2 },
        { weight_kg: 2.5, count: 4 },
      ],
    }

    const result = decompose(10, config)

    expect(result.exact).toBe(true)
    expect(result.plates).toEqual([{ weight_kg: 5, count: 1 }])
  })
})

describe('decompose — floating point safety', () => {
  it('sums 1.25 + 1.25 + 0.5 per side cleanly with no float drift', () => {
    const config: LoadingConfig = {
      mode: 'barbell',
      barWeight: 0,
      stock: [
        { weight_kg: 1.25, count: 4 },
        { weight_kg: 0.5, count: 2 },
      ],
    }

    // per-side target 3.0 = 1.25 + 1.25 + 0.5
    const result = decompose(6, config)

    expect(result.exact).toBe(true)
    expect(result.total).toBe(6)
    expect(result.total).not.toBe(5.999999999999999)
  })

  it('totalFor sums repeated fractional plates without drift (naive JS would not)', () => {
    // Raw JS: 1.1 + 1.1 + 1.1 === 3.3000000000000003, not 3.3.
    expect(1.1 + 1.1 + 1.1).not.toBe(3.3)

    const config: LoadingConfig = {
      mode: 'single',
      barWeight: 0,
      stock: [{ weight_kg: 1.1, count: 3 }],
    }
    const plates: PlateLoad[] = [{ weight_kg: 1.1, count: 3 }]

    expect(totalFor(plates, config)).toBe(3.3)
  })
})

describe('decompose — edge cases', () => {
  it('below-bar target returns empty plates and the bar weight', () => {
    const result = decompose(10, REAL_STOCK)

    expect(result.plates).toEqual([])
    expect(result.total).toBe(20)
    expect(result.exact).toBe(false)
    expect(result.reason).toBe('below-bar')
  })

  it('target exactly equal to the bar weight is exact with no plates', () => {
    const result = decompose(20, REAL_STOCK)

    expect(result.plates).toEqual([])
    expect(result.total).toBe(20)
    expect(result.exact).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it("mode 'free' is never loadable", () => {
    const config: LoadingConfig = { mode: 'free', barWeight: 0, stock: [] }

    const result = decompose(100, config)

    expect(result.plates).toEqual([])
    expect(result.exact).toBe(false)
    expect(result.reason).toBe('not-loadable')
  })

  it('empty stock (barbell) returns empty plates and total = barWeight', () => {
    const config: LoadingConfig = { mode: 'barbell', barWeight: 20, stock: [] }

    const result = decompose(80, config)

    expect(result.plates).toEqual([])
    expect(result.total).toBe(20)
    expect(result.exact).toBe(false)
  })

  it('empty stock (single) returns empty plates and total = 0', () => {
    const config: LoadingConfig = { mode: 'single', barWeight: 0, stock: [] }

    const result = decompose(25, config)

    expect(result.plates).toEqual([])
    expect(result.total).toBe(0)
    expect(result.exact).toBe(false)
  })
})

describe('decompose — single mode (dip belt / plate-loaded machine)', () => {
  it('uses full inventory (no per-side halving)', () => {
    const config: LoadingConfig = {
      mode: 'single',
      barWeight: 0,
      stock: [
        { weight_kg: 10, count: 3 },
        { weight_kg: 5, count: 1 },
      ],
    }

    const result = decompose(35, config)

    expect(result.exact).toBe(true)
    expect(result.total).toBe(35)
    expect(result.plates).toEqual([
      { weight_kg: 10, count: 3 },
      { weight_kg: 5, count: 1 },
    ])
  })
})

describe('totalFor', () => {
  it('doubles the plate sum and adds the bar for barbell mode', () => {
    const config: LoadingConfig = { mode: 'barbell', barWeight: 20, stock: [] }
    const plates: PlateLoad[] = [
      { weight_kg: 15, count: 2 },
      { weight_kg: 1.25, count: 1 },
    ]

    expect(totalFor(plates, config)).toBe(82.5)
  })

  it('sums plates directly (no doubling, no bar) for single mode', () => {
    const config: LoadingConfig = { mode: 'single', barWeight: 0, stock: [] }
    const plates: PlateLoad[] = [{ weight_kg: 10, count: 2 }]

    expect(totalFor(plates, config)).toBe(20)
  })
})

describe('addPlate', () => {
  it('adds a new denomination when stock allows', () => {
    const result = addPlate([], 15, REAL_STOCK)

    expect(result).toEqual([{ weight_kg: 15, count: 1 }])
  })

  it('increments an existing denomination', () => {
    const plates: PlateLoad[] = [{ weight_kg: 15, count: 1 }]

    const result = addPlate(plates, 15, REAL_STOCK)

    expect(result).toEqual([{ weight_kg: 15, count: 2 }])
  })

  it('refuses to exceed stock and returns the input unchanged', () => {
    const plates: PlateLoad[] = [{ weight_kg: 15, count: 2 }] // per side max for REAL_STOCK

    const result = addPlate(plates, 15, REAL_STOCK)

    expect(result).toBe(plates)
  })

  it('refuses a denomination not present in stock', () => {
    const plates: PlateLoad[] = []

    const result = addPlate(plates, 20, REAL_STOCK)

    expect(result).toBe(plates)
  })
})

describe('removePlate', () => {
  it('decrements a denomination with count > 1', () => {
    const plates: PlateLoad[] = [{ weight_kg: 15, count: 2 }]

    const result = removePlate(plates, 15)

    expect(result).toEqual([{ weight_kg: 15, count: 1 }])
  })

  it('drops the denomination entirely when count reaches 0', () => {
    const plates: PlateLoad[] = [{ weight_kg: 15, count: 1 }]

    const result = removePlate(plates, 15)

    expect(result).toEqual([])
  })

  it('is a no-op for a denomination not present', () => {
    const plates: PlateLoad[] = [{ weight_kg: 15, count: 1 }]

    const result = removePlate(plates, 10)

    expect(result).toBe(plates)
  })
})

describe('availableDenominations', () => {
  it('excludes exhausted denominations given what is already loaded', () => {
    const plates: PlateLoad[] = [{ weight_kg: 15, count: 2 }] // 15 exhausted per side (floor(4/2)=2)

    const available = availableDenominations(plates, REAL_STOCK)

    expect(available).not.toContain(15)
    expect(available).toEqual([10, 5, 2.5, 1.25, 0.5])
  })

  it('returns the full descending list when nothing is loaded', () => {
    const available = availableDenominations([], REAL_STOCK)

    expect(available).toEqual([15, 10, 5, 2.5, 1.25, 0.5])
  })

  it("returns an empty list for mode 'free'", () => {
    const config: LoadingConfig = {
      mode: 'free',
      barWeight: 0,
      stock: [{ weight_kg: 20, count: 4 }],
    }

    expect(availableDenominations([], config)).toEqual([])
  })
})
