import { describe, it, expect } from 'bun:test'
import { app } from '../index.js'

// Auth must run BEFORE schema validation so an unauthenticated request with
// a malformed body returns 401 (not 422 — which would echo the body and leak
// information to unauthenticated callers, and waste CPU on validation for
// rejected traffic). See authGuard in src/index.ts.

describe('POST /usage/records — auth precedes validation', () => {
  const malformedBody = JSON.stringify({
    records: [{ source: 'x', source_id: 'x', grain: 'message' }],
  })

  it('rejects missing bearer with 401 (not 422) even on malformed body', async () => {
    const res = await app.handle(
      new Request('http://localhost/usage/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: malformedBody,
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects wrong bearer with 401 (not 422) even on malformed body', async () => {
    const res = await app.handle(
      new Request('http://localhost/usage/records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer not-the-real-secret',
        },
        body: malformedBody,
      }),
    )
    expect(res.status).toBe(401)
  })
})
