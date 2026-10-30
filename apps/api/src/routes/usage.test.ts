import { describe, it, expect } from 'bun:test'
import { app } from '../app.js'
import { env } from '../env.js'

// Auth must run BEFORE schema validation so an unauthenticated request with
// a malformed query returns 401 (not 422 — which would echo the input and leak
// information to unauthenticated callers, and waste CPU on validation for
// rejected traffic). See authGuard in src/index.ts.

describe('GET /usage — auth precedes validation', () => {
  const malformed = 'http://localhost/usage/breakdown?range=nope&metric=nope&dimension=nope'

  it('rejects missing bearer with 401 (not 422) even on a malformed query', async () => {
    const res = await app.handle(new Request(malformed))
    expect(res.status).toBe(401)
  })

  it('rejects wrong bearer with 401 (not 422) even on a malformed query', async () => {
    const res = await app.handle(
      new Request(malformed, { headers: { Authorization: 'Bearer not-the-real-secret' } }),
    )
    expect(res.status).toBe(401)
  })

  it('validates only once the bearer is right', async () => {
    const res = await app.handle(
      new Request(malformed, { headers: { Authorization: `Bearer ${env.API_SECRET}` } }),
    )
    expect(res.status).toBe(422)
  })
})
