import { describe, expect, it } from 'bun:test'
import { shouldTraceRequest } from './trace-filter.js'

const traced = (path: string) => shouldTraceRequest({ url: `http://localhost${path}` })

describe('shouldTraceRequest', () => {
  it('never opens a server span for /finance, whatever the query or sub-path', () => {
    for (const path of [
      '/finance',
      '/finance/status',
      '/finance/unlock',
      '/finance/sync-runs?limit=5',
      '/finance/api/transactions?search=landlord&merchant=Grocer',
      '/finance/api/meta',
    ]) {
      expect([path, traced(path)]).toEqual([path, false])
    }
  })

  it('keeps the existing exclusions and still traces everything else', () => {
    expect(traced('/')).toBe(false)
    expect(traced('/health')).toBe(false)
    expect(traced('/openapi/json')).toBe(false)
    expect(traced('/workouts')).toBe(true)
    expect(traced('/usage/headline?window=7d')).toBe(true)
    // A route that merely starts with the letters is not the finance prefix.
    expect(traced('/financeish')).toBe(true)
  })
})
