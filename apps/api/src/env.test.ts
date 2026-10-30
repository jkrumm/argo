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

  describe('native runtime settings', () => {
    const required = { DATABASE_URL: 'postgres://x@localhost/x', API_SECRET: 'x' }

    it('defaults to the Docker-compatible values', () => {
      const parsed = Env.parse(required)
      expect(parsed.HOST).toBe('0.0.0.0')
      expect(parsed.DASHBOARD_DIR).toBe('')
      expect(parsed.CRONS_ENABLED).toBe(true)
    })

    it('fails closed: HOST defaults to loopback when DASHBOARD_DIR is set', () => {
      const parsed = Env.parse({ ...required, DASHBOARD_DIR: '/srv/dist' })
      expect(parsed.HOST).toBe('127.0.0.1')
    })

    it('treats an empty or blank HOST as unset, so dashboard mode still fails closed', () => {
      for (const HOST of ['', '   ']) {
        expect(Env.parse({ ...required, DASHBOARD_DIR: '/srv/dist', HOST }).HOST).toBe('127.0.0.1')
        expect(Env.parse({ ...required, HOST }).HOST).toBe('0.0.0.0')
      }
    })

    it('lets an explicit HOST win in either mode', () => {
      expect(Env.parse({ ...required, DASHBOARD_DIR: '/srv/dist', HOST: '0.0.0.0' }).HOST).toBe(
        '0.0.0.0',
      )
      expect(Env.parse({ ...required, HOST: '127.0.0.1' }).HOST).toBe('127.0.0.1')
    })

    it('reads CRONS_ENABLED from the strings true / false', () => {
      expect(Env.parse({ ...required, CRONS_ENABLED: 'false' }).CRONS_ENABLED).toBe(false)
      expect(Env.parse({ ...required, CRONS_ENABLED: 'true' }).CRONS_ENABLED).toBe(true)
    })

    it('rejects any other CRONS_ENABLED value', () => {
      expect(() => Env.parse({ ...required, CRONS_ENABLED: '0' })).toThrow()
      expect(() => Env.parse({ ...required, CRONS_ENABLED: '' })).toThrow()
    })

    it('takes HOST and DASHBOARD_DIR verbatim', () => {
      const parsed = Env.parse({ ...required, HOST: '127.0.0.1', DASHBOARD_DIR: '/srv/dist' })
      expect(parsed.HOST).toBe('127.0.0.1')
      expect(parsed.DASHBOARD_DIR).toBe('/srv/dist')
    })
  })
})
