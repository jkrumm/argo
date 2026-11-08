import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTokenStore } from './oauth-token-store.js'

const dirs: string[] = []
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'argo-tokens-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('token store', () => {
  it('keeps the other provider key when slices are updated concurrently', async () => {
    const dir = tmp()
    const store = createTokenStore(dir)
    writeFileSync(join(dir, 'oauth-tokens.json'), JSON.stringify({ m365: { refreshToken: 'r0' } }))
    await Promise.all([
      store.update('google', () => ({ accessToken: 'g1' })),
      store.update('m365', (c) => ({ ...(c as object), refreshToken: 'r1' })),
      store.update('google', () => ({ accessToken: 'g2' })),
    ])
    const onDisk = JSON.parse(readFileSync(store.file, 'utf-8'))
    expect(onDisk).toEqual({ google: { accessToken: 'g2' }, m365: { refreshToken: 'r1' } })
  })

  it('merges a refresh into a fresh read, not the stale one', async () => {
    const dir = tmp()
    const store = createTokenStore(dir)
    await store.update('google', () => ({ v: 1 }))
    await store.refresh('google', async () => {
      // the other provider rotates while the google refresh is in flight
      await store.update('m365', () => ({ refreshToken: 'rotated' }))
      return { v: 2 }
    })
    expect(JSON.parse(readFileSync(store.file, 'utf-8'))).toEqual({
      google: { v: 2 },
      m365: { refreshToken: 'rotated' },
    })
  })

  it('single-flights refresh per provider', async () => {
    const store = createTokenStore(tmp())
    let calls = 0
    const run = () =>
      store.refresh('google', async () => {
        calls++
        await new Promise((r) => setTimeout(r, 10))
        return { n: calls }
      })
    const results = await Promise.all([run(), run(), run()])
    expect(calls).toBe(1)
    expect(results).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }])
  })

  it('writes atomically with 0600 and leaves no temp files', async () => {
    const dir = tmp()
    const store = createTokenStore(dir)
    await store.update('google', () => ({ a: 1 }))
    expect(statSync(store.file).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['oauth-tokens.json'])
  })
})
