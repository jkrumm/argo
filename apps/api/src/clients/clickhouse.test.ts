import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { ClickHouseError, createClickHouse } from './clickhouse.js'

// DB-free: a fake ClickHouse HTTP interface on a loopback port.

type Seen = { method: string; search: string; auth: string | null; body: string }

let seen: Seen[] = []
let reply: () => Response = () => Response.json({ data: [] })
let fake: ReturnType<typeof Bun.serve>

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      seen.push({
        method: request.method,
        search: new URL(request.url).search,
        auth: request.headers.get('authorization'),
        body: await request.text(),
      })
      return reply()
    },
  })
})
afterAll(() => {
  void fake.stop(true)
})
beforeEach(() => {
  seen = []
  reply = () => Response.json({ data: [] })
})

const clientFor = (password = 'pw') =>
  createClickHouse({ url: `http://127.0.0.1:${fake.port}/`, user: 'argo_ro', password })

describe('createClickHouse', () => {
  it('posts the SQL as the body, params as param_ URL parameters, the credential only in the header', async () => {
    reply = () => Response.json({ data: [{ n: 1 }] })
    const rows = await clientFor('s3cret').query('t', 'SELECT {a:UInt32} AS n FORMAT JSON', {
      a: 7,
      b: 'x y',
    })
    expect(rows).toEqual([{ n: 1 }])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.body).toBe('SELECT {a:UInt32} AS n FORMAT JSON')
    expect(seen[0]?.search).toBe('?param_a=7&param_b=x+y')
    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from('argo_ro:s3cret').toString('base64')}`)
    expect(seen[0]?.search).not.toContain('s3cret')
  })

  it('sends no settings: a readonly user would be refused them', async () => {
    await clientFor().query('t', 'SELECT 1 FORMAT JSON', { a: 1 })
    expect(seen[0]?.search).not.toMatch(/(^|[?&])(?!param_)[a-z_]+=/)
  })

  it('throws a ClickHouseError with the status for a non-2xx answer, without echoing a long body', async () => {
    reply = () => new Response('Code: 497. ' + 'x'.repeat(1000), { status: 403 })
    const error = await clientFor()
      .query('t', 'SELECT 1 FORMAT JSON')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ClickHouseError)
    expect((error as ClickHouseError).status).toBe(403)
    expect((error as ClickHouseError).message.length).toBeLessThan(260)
  })

  it('throws ClickHouseError on a transport failure', async () => {
    const dead = createClickHouse({ url: 'http://127.0.0.1:1', user: 'u', password: 'p' })
    const error = await dead.query('t', 'SELECT 1 FORMAT JSON').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ClickHouseError)
    expect((error as ClickHouseError).status).toBeNull()
  })

  it('is unconfigured without a URL or a password and then makes no request', async () => {
    const off = createClickHouse({ url: '', user: 'u', password: 'p' })
    expect(off.configured).toBe(false)
    await expect(off.query('t', 'SELECT 1 FORMAT JSON')).rejects.toBeInstanceOf(ClickHouseError)
    const noPassword = clientFor('')
    expect(noPassword.configured).toBe(false)
    await expect(noPassword.query('t', 'SELECT 1 FORMAT JSON')).rejects.toBeInstanceOf(
      ClickHouseError,
    )
    expect(seen).toHaveLength(0)
  })
})
