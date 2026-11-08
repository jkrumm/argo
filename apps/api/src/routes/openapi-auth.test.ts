import { describe, it, expect } from 'bun:test'
import { app } from '../app.js'

// Public set, mirrored from `auth.public` on GET / (oauth routes are matched by prefix).
const PUBLIC = new Set(['/', '/health'])
const isPublic = (path: string) => PUBLIC.has(path) || path.startsWith('/oauth/')

type Spec = { paths: Record<string, Record<string, unknown>> }
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

describe('every non-public OpenAPI path rejects a missing bearer', () => {
  it('answers 401 without Authorization, with path params filled and no body', async () => {
    const res = await app.handle(new Request('http://localhost/openapi/json'))
    expect(res.status).toBe(200)
    const spec = (await res.json()) as Spec

    const failures: string[] = []
    let checked = 0
    for (const [path, ops] of Object.entries(spec.paths)) {
      if (isPublic(path)) continue
      for (const method of METHODS) {
        if (!(method in ops)) continue
        const url = `http://localhost${path.replace(/\{[^}]+\}/g, '1')}`
        const r = await app.handle(new Request(url, { method: method.toUpperCase() }))
        checked++
        if (r.status !== 401) failures.push(`${method.toUpperCase()} ${path} -> ${r.status}`)
      }
    }
    expect(checked).toBeGreaterThan(50)
    expect(failures).toEqual([])
  })
})
