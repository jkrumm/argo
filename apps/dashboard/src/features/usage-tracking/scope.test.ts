import { describe, expect, it } from 'bun:test'
import type { UsageIuKey } from '../../lib/window-stores'
import { iuKeyScope, selectedKeyWallet } from './scope'

describe('iuKeyScope', () => {
  it('scopes to exactly one key, never both', () => {
    expect(iuKeyScope('personal').payers).toEqual(['iu-api'])
    expect(iuKeyScope('athena-team').payers).toEqual(['iu-team-api'])
  })

  it('reads a stale key (the retired `all`) as the personal one instead of throwing', () => {
    const stale = 'all' as unknown as UsageIuKey
    expect(selectedKeyWallet(stale).iuKey).toBe('personal')
    expect(iuKeyScope(stale).payers).toEqual(['iu-api'])
  })
})
