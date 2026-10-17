import { describe, it, expect } from 'bun:test'
import { app } from '../app.js'

// Auth-surface tests only — the real Graph call is exercised manually via
// apps/api/scripts/m365-discover.ts and scripts/m365-probe.ts (one-shot).
// There is no MCP mock in this codebase yet; once we have several wrappers
// and a stable contract we can introduce one.

describe('GET /m365/calendar/upcoming — auth', () => {
  it('rejects missing bearer with 401', async () => {
    const res = await app.handle(new Request('http://localhost/m365/calendar/upcoming'))
    expect(res.status).toBe(401)
  })

  it('rejects wrong bearer with 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/m365/calendar/upcoming', {
        headers: { Authorization: 'Bearer not-the-real-secret' },
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /m365/calendar/upcoming — from', () => {
  const AUTH = { Authorization: `Bearer ${process.env['API_SECRET'] ?? ''}` }
  const get = (query: string) =>
    app.handle(new Request(`http://localhost/m365/calendar/upcoming${query}`, { headers: AUTH }))

  it('rejects a malformed from with 422', async () => {
    expect((await get('?from=yesterday')).status).toBe(422)
    expect((await get('?from=2026-13-45')).status).toBe(422)
    expect((await get('?from=2026-10-12Tnope')).status).toBe(422)
  })

  it('accepts an ISO date and an ISO datetime (validation passes; upstream decides the rest)', async () => {
    expect((await get('?from=2026-10-12')).status).not.toBe(422)
    expect((await get('?from=2026-10-12T00:00:00.000Z&days=7')).status).not.toBe(422)
  })

  it('keeps the days cap', async () => {
    expect((await get('?from=2026-10-12&days=61')).status).toBe(422)
  })
})
