/**
 * Pure barbell/dip-belt plate calculator engine.
 *
 * A logged set stores an absolute total weight in kg (always including the bar, if any).
 * This module decomposes that total into physical plates the user actually owns, and
 * offers small mutators for an interactive "build your own load" UI.
 *
 * All internal arithmetic works in integer hundredths of a kg (i.e. cents-of-a-kilogram)
 * so plate sums never drift into floating point noise (1.1 + 1.1 + 1.1 !== 3.3 in raw
 * JS). Callers only ever see plain kg numbers — the hundredths representation never
 * crosses the public interface.
 */

export type LoadingMode = 'barbell' | 'single' | 'free'

export type PlateStock = { weight_kg: number; count: number }[]

export interface LoadingConfig {
  mode: LoadingMode
  /** 0 for 'single' — dip belts and plate-loaded machines carry no bar. */
  barWeight: number
  stock: PlateStock
}

/** One denomination loaded n times per side (barbell) or n times total (single). */
export interface PlateLoad {
  weight_kg: number
  count: number
}

export interface Decomposition {
  /** Descending by weight_kg. */
  plates: PlateLoad[]
  /** The total this loading actually achieves (including the bar). */
  total: number
  /** Whether total === the requested target. */
  exact: boolean
  reason?: 'below-bar' | 'unreachable' | 'not-loadable'
}

const HUNDREDTHS_PER_KG = 100

function toHundredths(kg: number): number {
  return Math.round(kg * HUNDREDTHS_PER_KG)
}

function fromHundredths(hundredths: number): number {
  return hundredths / HUNDREDTHS_PER_KG
}

/** A single loadable denomination: weight plus how many can still be used. */
interface Denomination {
  weight_kg: number
  weightHundredths: number
  available: number
}

/** Best-achievable-sum-at-or-below-target result from the exact search. */
interface SearchResult {
  sumHundredths: number
  plateCount: number
  /** Picks per denomination, same order/length as the denominations array passed in. */
  picks: number[]
}

/**
 * Denominations usable for this loading mode, sorted descending by weight.
 * Barbell plates load symmetrically, so a denomination is only usable per side if the
 * user owns at least 2 (one per side) — available per side is floor(count / 2). Single
 * loading (dip belt, plate-loaded machine) has no symmetry constraint — the full
 * inventory is available.
 */
function buildDenominations(config: LoadingConfig): Denomination[] {
  const perUnit = config.mode === 'barbell' ? 2 : 1
  return config.stock
    .map((plate) => ({
      weight_kg: plate.weight_kg,
      weightHundredths: toHundredths(plate.weight_kg),
      available: Math.floor(plate.count / perUnit),
    }))
    .filter((denom) => denom.available > 0 && denom.weightHundredths > 0)
    .toSorted((a, b) => b.weightHundredths - a.weightHundredths)
}

/**
 * Exact bounded DFS over denominations (descending), memoized on (denominations
 * remaining, hundredths remaining). Finds the maximum achievable sum <= targetHundredths;
 * among ties, prefers fewer total plates. The search space is tiny (a handful of
 * denominations, single-digit counts each), so plain greedy is not used — greedy is
 * provably wrong on real plate sets (e.g. a lone 10 blocks a better 6+5 pairing).
 */
function findBestLoad(denominations: Denomination[], targetHundredths: number): SearchResult {
  const memo = new Map<string, SearchResult>()

  function search(remaining: readonly Denomination[], budget: number): SearchResult {
    if (remaining.length === 0 || budget <= 0) {
      return { sumHundredths: 0, plateCount: 0, picks: [] }
    }

    const key = `${remaining.length}:${budget}`
    const cached = memo.get(key)
    if (cached) return cached

    const [denom, ...rest] = remaining
    if (!denom) {
      return { sumHundredths: 0, plateCount: 0, picks: [] }
    }

    const maxUsable = Math.min(denom.available, Math.floor(budget / denom.weightHundredths))

    let best: SearchResult | null = null
    for (let use = maxUsable; use >= 0; use--) {
      const restResult = search(rest, budget - use * denom.weightHundredths)
      const sumHundredths = use * denom.weightHundredths + restResult.sumHundredths
      const plateCount = use + restResult.plateCount
      const better =
        !best ||
        sumHundredths > best.sumHundredths ||
        (sumHundredths === best.sumHundredths && plateCount < best.plateCount)
      if (better) {
        best = { sumHundredths, plateCount, picks: [use, ...restResult.picks] }
      }
    }

    const result = best ?? { sumHundredths: 0, plateCount: 0, picks: [] }
    memo.set(key, result)
    return result
  }

  return search(denominations, targetHundredths)
}

function picksToPlateLoads(denominations: Denomination[], picks: number[]): PlateLoad[] {
  const plates: PlateLoad[] = []
  denominations.forEach((denom, index) => {
    const count = picks[index] ?? 0
    if (count > 0) {
      plates.push({ weight_kg: denom.weight_kg, count })
    }
  })
  return plates
}

export function decompose(target: number, config: LoadingConfig): Decomposition {
  if (config.mode === 'free') {
    return { plates: [], total: 0, exact: false, reason: 'not-loadable' }
  }

  const barWeight = config.mode === 'barbell' ? config.barWeight : 0
  const targetHundredths = toHundredths(target)
  const barHundredths = toHundredths(barWeight)

  if (targetHundredths < barHundredths) {
    return { plates: [], total: fromHundredths(barHundredths), exact: false, reason: 'below-bar' }
  }

  const remainingHundredths = targetHundredths - barHundredths

  if (remainingHundredths === 0) {
    return { plates: [], total: fromHundredths(barHundredths), exact: true }
  }

  // Barbell plates load symmetrically — the search operates on one side's budget
  // (half the remaining weight) and the achieved total doubles it back.
  const searchBudget =
    config.mode === 'barbell' ? Math.floor(remainingHundredths / 2) : remainingHundredths

  const denominations = buildDenominations(config)
  const best = findBestLoad(denominations, searchBudget)
  const plates = picksToPlateLoads(denominations, best.picks)

  const achievedSideOrTotal =
    config.mode === 'barbell' ? best.sumHundredths * 2 : best.sumHundredths
  const achievedHundredths = barHundredths + achievedSideOrTotal
  const exact = achievedHundredths === targetHundredths

  return {
    plates,
    total: fromHundredths(achievedHundredths),
    exact,
    ...(exact ? {} : { reason: 'unreachable' as const }),
  }
}

export function totalFor(plates: PlateLoad[], config: LoadingConfig): number {
  const plateSumHundredths = plates.reduce(
    (sum, plate) => sum + toHundredths(plate.weight_kg) * plate.count,
    0,
  )

  if (config.mode === 'barbell') {
    return fromHundredths(toHundredths(config.barWeight) + plateSumHundredths * 2)
  }

  return fromHundredths(plateSumHundredths)
}

export function addPlate(
  plates: PlateLoad[],
  weight_kg: number,
  config: LoadingConfig,
): PlateLoad[] {
  const weightHundredths = toHundredths(weight_kg)
  const stockEntry = config.stock.find(
    (plate) => toHundredths(plate.weight_kg) === weightHundredths,
  )
  if (!stockEntry) return plates

  const isAvailable = availableDenominations(plates, config).some(
    (available) => toHundredths(available) === weightHundredths,
  )
  if (!isAvailable) return plates

  const existingIndex = plates.findIndex(
    (plate) => toHundredths(plate.weight_kg) === weightHundredths,
  )
  if (existingIndex === -1) {
    return [...plates, { weight_kg: stockEntry.weight_kg, count: 1 }].toSorted(
      (a, b) => b.weight_kg - a.weight_kg,
    )
  }

  return plates.map((plate, index) =>
    index === existingIndex ? { ...plate, count: plate.count + 1 } : plate,
  )
}

export function removePlate(plates: PlateLoad[], weight_kg: number): PlateLoad[] {
  const weightHundredths = toHundredths(weight_kg)
  const index = plates.findIndex((plate) => toHundredths(plate.weight_kg) === weightHundredths)
  if (index === -1) return plates

  const current = plates[index]
  if (!current || current.count <= 1) {
    return plates.filter((_, i) => i !== index)
  }

  return plates.map((plate, i) => (i === index ? { ...plate, count: plate.count - 1 } : plate))
}

export function availableDenominations(plates: PlateLoad[], config: LoadingConfig): number[] {
  if (config.mode === 'free') return []

  const perUnit = config.mode === 'barbell' ? 2 : 1

  return config.stock
    .filter((plate) => {
      const available = Math.floor(plate.count / perUnit)
      if (available <= 0) return false

      const weightHundredths = toHundredths(plate.weight_kg)
      const used = plates.find((p) => toHundredths(p.weight_kg) === weightHundredths)?.count ?? 0
      return used < available
    })
    .map((plate) => plate.weight_kg)
    .toSorted((a, b) => b - a)
}
