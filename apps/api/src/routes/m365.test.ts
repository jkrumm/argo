import { describe, it, expect } from 'bun:test'
import { app } from '../index.js'

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
