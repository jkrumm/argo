import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env.js'

// One token file (DATA_DIR/oauth-tokens.json) shared by every OAuth provider,
// each owning one top-level key (`google`, `m365`). All writes go through here:
//   - an in-process mutex serialises read-modify-write, and the file is re-read
//     under the lock so a provider only ever replaces its OWN key;
//   - refreshes are single-flight per provider (one upstream call, many waiters);
//   - the file is written to a temp file in the same directory and renamed, so a
//     crash mid-write never leaves a truncated file.
// The on-disk format is unchanged: `{ "<provider>": { ... }, ... }`.

type Store = Record<string, unknown>

export function createTokenStore(dataDir: string) {
  const file = join(dataDir, 'oauth-tokens.json')
  let tail: Promise<unknown> = Promise.resolve()
  let tmpCounter = 0
  const inflight = new Map<string, Promise<unknown>>()

  function readAll(): Store {
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf-8')) as Store
  }

  function writeAll(store: Store): void {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }

  function locked<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = tail.then(fn)
    tail = run.catch(() => undefined)
    return run
  }

  function read<T>(provider: string): T | undefined {
    return readAll()[provider] as T | undefined
  }

  /** Replace one provider's slice; the rest of the file is re-read under the lock and kept. */
  function update<T>(provider: string, fn: (current: T | undefined) => T): Promise<T> {
    return locked(() => {
      const store = readAll()
      const next = fn(store[provider] as T | undefined)
      store[provider] = next
      writeAll(store)
      return next
    })
  }

  /**
   * Refresh one provider's slice at most once at a time. `refresh` runs outside
   * the lock (it is a network call) and returns the new slice; it is merged
   * under the lock into a fresh read of the file.
   */
  function refresh<T>(provider: string, doRefresh: (current: T | undefined) => Promise<T>) {
    const pending = inflight.get(provider) as Promise<T> | undefined
    if (pending) return pending
    const run = (async () => {
      const next = await doRefresh(read<T>(provider))
      return update<T>(provider, () => next)
    })().finally(() => inflight.delete(provider))
    inflight.set(provider, run)
    return run
  }

  return { file, read, update, refresh }
}

export const tokenStore = createTokenStore(env.DATA_DIR)
