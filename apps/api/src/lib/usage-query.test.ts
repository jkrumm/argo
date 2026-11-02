import { describe, it, expect } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { API_PAYERS, CREDIT_PAYERS, PAYERS, PAYER_EXPR } from './usage-query.js'

const text = new PgDialect().sqlToQuery(PAYER_EXPR).sql
/** The `WHEN … THEN '<payer>'` condition of one payer, whitespace-normalised. */
const whenOf = (payer: string): string | undefined =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.endsWith(`THEN '${payer}'`))
    ?.replace(/^WHEN (.*) THEN .*$/, '$1')

describe('PAYER_EXPR', () => {
  it('has exactly one branch per payer but unknown, which is the ELSE', () => {
    for (const payer of PAYERS.filter((p) => p !== 'unknown')) expect(whenOf(payer)).toBeDefined()
    expect(text).toContain("ELSE 'unknown'")
    expect(text.match(/THEN '/g)).toHaveLength(PAYERS.length - 1)
  })

  it('maps api_credit plus the account to the three credit payers', () => {
    expect(whenOf('iu-credit')).toBe("billing = 'api_credit' AND account = 'iu'")
    expect(whenOf('me-credit')).toBe("billing = 'api_credit' AND account = 'me'")
    expect(whenOf('me2-credit')).toBe("billing = 'api_credit' AND account = 'me2'")
  })

  it('keeps credit pools out of the metered-API default set', () => {
    expect(CREDIT_PAYERS).toEqual(['iu-credit', 'me-credit', 'me2-credit'])
    for (const payer of CREDIT_PAYERS) {
      expect(PAYERS).toContain(payer)
      expect(API_PAYERS as readonly string[]).not.toContain(payer)
    }
  })
})
