import { describe, it, expect } from 'bun:test'
import { app } from '../app.js'

const AUTH = { Authorization: `Bearer ${process.env['API_SECRET'] ?? ''}` }
const get = (query: string, headers: Record<string, string> = AUTH) =>
  app.handle(new Request(`http://localhost/calendar${query}`, { headers }))

describe('GET /calendar', () => {
  it('rejects a missing bearer with 401', async () => {
    expect((await get('', {})).status).toBe(401)
  })

  it('rejects a malformed from with 422', async () => {
    expect((await get('?from=yesterday')).status).toBe(422)
    expect((await get('?from=2026-13-45')).status).toBe(422)
    expect((await get('?from=2026-10-12Tnope')).status).toBe(422)
  })

  it('rejects a date that rolls over and a datetime without an offset', async () => {
    expect((await get('?from=2026-02-31')).status).toBe(422)
    expect((await get('?from=2026-10-12T00:00:00')).status).toBe(422)
    expect((await get('?from=2026-10-12T25:00:00Z')).status).toBe(422)
  })

  it('accepts an explicit offset', async () => {
    expect((await get('?from=2026-10-12T00:00:00%2B02:00')).status).not.toBe(422)
  })

  it('accepts an ISO date and an ISO datetime (validation passes; upstream decides the rest)', async () => {
    expect((await get('?from=2026-10-12')).status).not.toBe(422)
    expect((await get('?from=2026-10-12T00:00:00.000Z&days=7')).status).not.toBe(422)
  })

  it('documents from in the OpenAPI spec', async () => {
    const res = await app.handle(new Request('http://localhost/openapi/json', { headers: AUTH }))
    const spec = (await res.json()) as {
      paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }>
    }
    const names = (spec.paths['/calendar']?.get?.parameters ?? []).map((p) => p.name)
    expect(names).toContain('from')
  })
})
