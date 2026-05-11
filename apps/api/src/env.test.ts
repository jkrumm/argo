import { describe, it, expect } from 'bun:test'
import { Env } from './env.js'

describe('Env', () => {
  it('parses valid required fields with correct defaults', () => {
    const parsed = Env.parse({
      DATABASE_URL: 'postgres://argo:pw@localhost:5432/argo',
      API_SECRET: 'test-secret',
    })
    expect(parsed.DATABASE_URL).toBe('postgres://argo:pw@localhost:5432/argo')
    expect(parsed.API_SECRET).toBe('test-secret')
    expect(parsed.NODE_ENV).toBe('development')
    expect(parsed.OTEL_SERVICE_NAME).toBe('argo-api')
    expect(parsed.GARMIN_BACKFILL_DAYS).toBe(7)
  })

  it('throws when required fields are missing', () => {
    expect(() => Env.parse({})).toThrow()
  })
})
