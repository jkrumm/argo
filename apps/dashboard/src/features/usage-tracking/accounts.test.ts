import { describe, expect, it } from 'bun:test'
import {
  IU_API,
  IU_KEYS,
  IU_KEY_WALLETS,
  ME_API,
  SUB_WALLETS,
  USAGE_PAYERS,
  isKeyWallet,
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
