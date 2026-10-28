import { describe, expect, it } from 'bun:test'
import {
  WALLET_COLUMNS,
  WALLET_MIN_PX,
  liveSubscriptions,
  liveWallets,
  rowSizes,
  walletBreakpoints,
  walletSpans,
} from './wallet-model'

const total = (payer: string, cost: number, fresh = cost) => ({ payer, cost, fresh })

describe('liveSubscriptions', () => {
  it('lists the subscriptions with usage in registry order, and none without any', () => {
    const subs = liveSubscriptions([total('me-sub', 10), total('iu-sub', 500)], [])
    expect(subs.map((s) => s.id)).toEqual(['iu-sub', 'me-sub'])
  })

  it('has no card for a subscription with neither usage nor a quota sample (me2 before its first login)', () => {
    const subs = liveSubscriptions([total('iu-sub', 5), total('me2-sub', 0, 0)], ['iu', 'me'])
    expect(subs.map((s) => s.account)).toEqual(['iu', 'me'])
  })

  it('lists a subscription by its quota sample alone, and by usage alone', () => {
    expect(liveSubscriptions([], ['me2']).map((s) => s.id)).toEqual(['me2-sub'])
    expect(liveSubscriptions([total('me2-sub', 3)], []).map((s) => s.id)).toEqual(['me2-sub'])
  })

  it('shows the new subscription as soon as it has a row, with no other change', () => {
    const ids = liveSubscriptions(
      [total('iu-sub', 9), total('me-sub', 4), total('me2-sub', 1)],
      [],
    ).map((s) => s.id)
    expect(ids).toEqual(['iu-sub', 'me-sub', 'me2-sub'])
  })
})

const ids = (cost: number) =>
  liveWallets([total('iu-sub', 9), total('me-api', cost)], []).map((w) => w.id)

describe('liveWallets', () => {
  it('ends with one card per IU API key, which always has one', () => {
    expect(liveWallets([], []).map((w) => w.id)).toEqual(['iu-api', 'iu-team-api'])
  })

  it('gives the team key its own wallet and cap, apart from the personal one', () => {
    const [personal, team] = liveWallets([], []).map((w) => (w.kind === 'api' ? w.iuKey : null))
    expect([personal, team]).toEqual(['personal', 'athena-team'])
  })

  it('adds Me API only from a dollar', () => {
    expect(ids(0.4)).toEqual(['iu-sub', 'iu-api', 'iu-team-api'])
    expect(ids(1)).toEqual(['iu-sub', 'iu-api', 'iu-team-api', 'me-api'])
  })
})

describe('rowSizes', () => {
  it('spreads the cards over as few rows as the per-row limit allows, as evenly as possible', () => {
    expect(rowSizes(5, 5)).toEqual([5])
    expect(rowSizes(5, 4)).toEqual([3, 2])
    expect(rowSizes(5, 3)).toEqual([3, 2])
    expect(rowSizes(5, 2)).toEqual([2, 2, 1])
    expect(rowSizes(5, 1)).toEqual([1, 1, 1, 1, 1])
    expect(rowSizes(6, 4)).toEqual([3, 3])
    expect(rowSizes(4, 3)).toEqual([2, 2])
  })
})

describe('walletSpans', () => {
  /** The spans of every card at a container width: the widest breakpoint the width has reached. */
  const spansAt = (cards: number, width: number): number[] => {
    const breakpoints = walletBreakpoints(cards)
    return walletSpans(cards).map((spans) => {
      const reached = (['xs', 'sm', 'md', 'lg', 'xl'] as const)
        .filter(
          (name) => spans[name] !== undefined && Number.parseInt(breakpoints[name], 10) <= width,
        )
        .map((name) => spans[name]!)
      return reached.at(-1) ?? spans.base ?? 0
    })
  }
  /** The container width from which every wallet sits in one row. */
  const oneRowAt = (cards: number): number =>
    Math.max(...Object.values(walletBreakpoints(cards)).map((w) => Number.parseInt(w, 10)))
  const evenly = (n: number) => Array.from({ length: n }, () => WALLET_COLUMNS / n)

  it('holds every wallet in one row at the widest container, 3 to 6 wallets', () => {
    for (const n of [3, 4, 5, 6]) expect(spansAt(n, 5000)).toEqual(evenly(n))
  })

  it('never lets a card get narrower than the minimum in the one-row layout', () => {
    for (const n of [3, 4, 5, 6]) {
      const width = oneRowAt(n)
      expect(width / n).toBeGreaterThanOrEqual(WALLET_MIN_PX)
      expect(spansAt(n, width - 1)).not.toEqual(evenly(n))
    }
  })

  it('splits five wallets into two rows, three thirds then two halves, below the one-row width', () => {
    expect(spansAt(5, oneRowAt(5) - 1)).toEqual([20, 20, 20, 30, 30])
    expect(spansAt(5, oneRowAt(5))).toEqual(evenly(5))
  })

  it('splits four into 2 + 2, six into 3 + 3 and three into 2 + 1 before the one-row width', () => {
    expect(spansAt(4, oneRowAt(4) - 1)).toEqual([30, 30, 30, 30])
    expect(spansAt(6, oneRowAt(6) - 1)).toEqual([20, 20, 20, 20, 20, 20])
    expect(spansAt(3, oneRowAt(3) - 1)).toEqual([30, 30, 60])
  })

  it('puts one wallet per row at the narrowest container', () => {
    for (const n of [3, 4, 5, 6])
      expect(spansAt(n, WALLET_MIN_PX - 1)).toEqual(Array.from({ length: n }, () => WALLET_COLUMNS))
  })

  it('gives every row an even split of the whole row at every width, so no row leaves a gap', () => {
    for (const n of [3, 4, 5, 6]) {
      const widths = [0, ...Object.values(walletBreakpoints(n)).map((w) => Number.parseInt(w, 10))]
      for (const width of widths) {
        let used = 0
        for (const span of spansAt(n, width)) {
          used += span
          expect(used).toBeLessThanOrEqual(WALLET_COLUMNS)
          if (used === WALLET_COLUMNS) used = 0
        }
        expect(used).toBe(0)
      }
    }
  })
})
