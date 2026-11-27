import { describe, expect, it } from 'bun:test'
import { PrintSchema, printBody, printSummary } from './print'

describe('print form', () => {
  it('sends two-sided as the default and leaves out an empty page selection', () => {
    expect(printBody({ sides: 'auto', pages: '  ', copies: 1 })).toEqual({
      sides: 'auto',
      copies: 1,
    })
    expect(printBody({ sides: 'simplex', pages: '1-3, 5', copies: 2 })).toEqual({
      sides: 'simplex',
      pages: '1-3,5',
      copies: 2,
    })
  })

  it('refuses a page selection the API would refuse, and copies out of range', () => {
    const ok = (over: object) =>
      PrintSchema.safeParse({ sides: 'auto', pages: '', copies: 1, ...over }).success
    expect(ok({ pages: '8-' })).toBe(true)
    expect(ok({ pages: 'first' })).toBe(false)
    expect(ok({ copies: 0 })).toBe(false)
    expect(ok({ copies: 100 })).toBe(false)
  })

  it('says what the printer took', () => {
    expect(printSummary({ sides: 'two-sided-long-edge', pageCount: 4, copies: 1 })).toBe(
      'two-sided-long-edge · 4 pages',
    )
  })
})
