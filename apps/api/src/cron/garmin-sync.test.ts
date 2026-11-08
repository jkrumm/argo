import { describe, expect, test } from 'bun:test'
import { createSyncGuard, type GarminSyncResult } from './garmin-sync.js'

const ok: GarminSyncResult = { errors: 0, message: 'ok', daysSynced: 1, activitiesSynced: 0 }

describe('createSyncGuard', () => {
  test('finishes with the result and allows a later run', async () => {
    const finished: GarminSyncResult[] = []
    const run = createSyncGuard({
      begin: async () => {},
      finish: async (r) => void finished.push(r),
    })
    expect(await run(async () => ok)).toEqual(ok)
    expect(await run(async () => ok)).toEqual(ok)
    expect(finished).toHaveLength(2)
  })

  test('resets both flags when fn throws', async () => {
    const finished: GarminSyncResult[] = []
    const run = createSyncGuard({
      begin: async () => {},
      finish: async (r) => void finished.push(r),
    })
    await expect(
      run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(finished[0]?.errors).toBe(1)
    expect(finished[0]?.message).toContain('boom')
    expect(await run(async () => ok)).toEqual(ok)
  })

  test('resets both flags when begin throws', async () => {
    let fail = true
    let finishCalls = 0
    const run = createSyncGuard({
      begin: async () => {
        if (fail) throw new Error('db down')
      },
      finish: async () => void finishCalls++,
    })
    await expect(run(async () => ok)).rejects.toThrow('db down')
    expect(finishCalls).toBe(1)
    fail = false
    expect(await run(async () => ok)).toEqual(ok)
  })

  test('a throwing finish does not leave the run stuck', async () => {
    const run = createSyncGuard({
      begin: async () => {},
      finish: async () => {
        throw new Error('db down')
      },
    })
    expect(await run(async () => ok)).toEqual(ok)
    expect(await run(async () => ok)).toEqual(ok)
  })

  test('skips a concurrent run', async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    const run = createSyncGuard({ begin: async () => {}, finish: async () => {} })
    const first = run(async () => {
      await gate
      return ok
    })
    const second = await run(async () => ok)
    expect(second.message).toBe('already in progress')
    release()
    await first
  })
})
