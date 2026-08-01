import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { Elysia } from 'elysia'
import { gymRoutes } from './gym.js'
import { db, runMigrations } from '../db/index.js'
import { gymState } from '../db/schema.js'

beforeAll(async () => {
  await runMigrations()
})

type GymResponse = {
  state: {
    activeId: string
    profiles: Array<{
      id: string
      name: string
      bars: Array<{ id: string; name: string; weight_kg: number }>
      plates: Array<{ weight_kg: number; count: number }>
      defaultBarId: string
      exercises: Record<string, { mode: string; barId?: string }>
    }>
  } | null
  updated_at: string | null
}

// The 10 kg bar is the case this endpoint exists for: it used to live only in
// one browser's localStorage, so a second device rendered the 20 kg seed.
const HOME_10KG = {
  activeId: 'home',
  profiles: [
    {
      id: 'home',
      name: 'Home Gym',
      bars: [{ id: 'olympic', name: 'Olympic Barbell', weight_kg: 10 }],
      plates: [{ weight_kg: 15, count: 4 }],
      defaultBarId: 'olympic',
      exercises: { bench_press: { mode: 'barbell', barId: 'olympic' } },
    },
  ],
}

function gymApp() {
  return new Elysia().use(gymRoutes)
}

function get() {
  return gymApp().handle(new Request('http://localhost/gym'))
}

function put(body: unknown) {
  return gymApp().handle(
    new Request('http://localhost/gym', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('/gym', () => {
  afterEach(async () => {
    await db.delete(gymState)
  })

  it('reports an un-seeded config as null rather than an error', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const body = (await res.json()) as GymResponse
    expect(body.state).toBeNull()
    expect(body.updated_at).toBeNull()
  })

  it('round-trips a bar weight so a second device reads the same number', async () => {
    const put1 = await put(HOME_10KG)
    expect(put1.status).toBe(200)

    const res = await get()
    const body = (await res.json()) as GymResponse
    expect(body.state?.profiles[0]?.bars[0]?.weight_kg).toBe(10)
    expect(body.updated_at).not.toBeNull()
  })

  it('replaces the whole state instead of merging', async () => {
    await put(HOME_10KG)
    await put({
      ...HOME_10KG,
      profiles: [{ ...HOME_10KG.profiles[0], bars: [], plates: [] }],
    })

    const body = (await get().then((r) => r.json())) as GymResponse
    expect(body.state?.profiles[0]?.bars).toEqual([])
    expect(body.state?.profiles).toHaveLength(1)
  })

  it('rejects a zero-weight bar', async () => {
    const res = await put({
      ...HOME_10KG,
      profiles: [
        {
          ...HOME_10KG.profiles[0],
          bars: [{ id: 'olympic', name: 'Olympic Barbell', weight_kg: 0 }],
        },
      ],
    })
    expect(res.status).toBe(422)
  })
})
