import { describe, expect, it } from 'bun:test'
import {
  IU_API,
  IU_KEYS,
  IU_KEY_WALLETS,
  ME_API,
  PAYER_LABELS,
  PLAN_PRICE_USD,
  SUB_WALLETS,
  USAGE_ACCOUNTS,
  USAGE_PAYERS,
  isKeyWallet,
  planSuffix,
} from './accounts'

describe('IU key registry', () => {
  it('pays every key as a registered payer, so a key is one entry plus its payer', () => {
    const payers = USAGE_PAYERS.map((p) => p.id)
    for (const key of IU_KEYS) expect(payers).toContain(key.payer)
  })

  it('derives one wallet per key, in registry order, each its own cap', () => {
    expect(IU_KEY_WALLETS.map((w) => [w.id, w.iuKey])).toEqual([
      ['iu-api', 'personal'],
      ['iu-team-api', 'athena-team'],
    ])
  })

  it('reads a gap as pricing on the personal key and as unseen spend on the team key', () => {
    expect(IU_KEY_WALLETS.map((w) => w.gapReading)).toEqual(['pricing', 'unseen'])
  })

  it('labels each key as the Key control does', () => {
    expect(IU_KEY_WALLETS.map((w) => w.label)).toEqual(['Personal', 'Athena team'])
  })

  it('finds the personal wallet by its payer id', () => {
    expect(IU_API.iuKey).toBe('personal')
    expect(IU_API.id).toBe('iu-api')
  })
})

describe('isKeyWallet', () => {
  it('is true for the IU key wallets only, so no other wallet fires a cap query', () => {
    expect(IU_KEY_WALLETS.every(isKeyWallet)).toBe(true)
    expect(isKeyWallet(ME_API)).toBe(false)
    expect(SUB_WALLETS.some(isKeyWallet)).toBe(false)
  })
})

describe('plans and credit payers', () => {
  it('prices iu as Ultra at $200 and the Max accounts at $100, the same as the credit each grants', () => {
    expect(USAGE_ACCOUNTS.map((a) => [a.id, a.plan, PLAN_PRICE_USD[a.plan]])).toEqual([
      ['iu', 'ultra', 200],
      ['me', '5x', 100],
      ['me2', '5x', 100],
    ])
    expect(PAYER_LABELS['iu-sub']).toBe('IU Ultra')
    expect(SUB_WALLETS.map((w) => `${w.title}${planSuffix(w.plan)}`)).toEqual([
      'IU Ultra',
      'Me Max 5x',
      'Me2 Max 5x',
    ])
  })

  it('registers one credit payer per subscription, labelled as the Credits tab names the pool', () => {
    const ids = USAGE_PAYERS.map((p) => p.id)
    for (const a of USAGE_ACCOUNTS) expect(ids).toContain(a.creditPayer)
    expect(USAGE_ACCOUNTS.map((a) => PAYER_LABELS[a.creditPayer])).toEqual([
      'IU credit',
      'Me credit',
      'Me2 credit',
    ])
  })

  it('draws the credit pools in a family of their own, neither the subscriptions’ nor the APIs’', () => {
    const family = (id: string) => USAGE_PAYERS.find((p) => p.id === id)!.shade[0]
    const credit = new Set(USAGE_ACCOUNTS.map((a) => family(a.creditPayer)))
    expect(credit.size).toBe(1)
    expect(credit.has(family('iu-sub'))).toBe(false)
    expect(credit.has(family('iu-api'))).toBe(false)
  })
})
