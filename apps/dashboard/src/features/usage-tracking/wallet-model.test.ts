import { describe, expect, it } from 'bun:test'
import { liveSubscriptions, liveWallets } from './wallet-model'

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
  it('ends with the IU API, which always has a card', () => {
    expect(liveWallets([], []).map((w) => w.id)).toEqual(['iu-api'])
  })

  it('adds Me API only from a dollar', () => {
    expect(ids(0.4)).toEqual(['iu-sub', 'iu-api'])
    expect(ids(1)).toEqual(['iu-sub', 'iu-api', 'me-api'])
  })
})
