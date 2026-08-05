import { describe, expect, it } from 'bun:test'
import {
  claimActiveStream,
  clearActiveStream,
  isStreamLive,
  resumeOrDead,
  turnAlreadyPersisted,
  type HermesStreaming,
  type ThreadPointerStore,
} from './hermes-streams.js'

// Pure unit tests over in-memory fakes for both ports — no Postgres, no HTTP,
// no app.handle(...). This is the entire point of extracting this logic out of
// routes/hermes.ts: the CAS + stream-liveness guards can now be exercised
// directly, in memory.

type CasCall = { threadId: string; expected: string | null; next: string | null }

/** A `ThreadPointerStore` backed by a plain in-memory map, mimicking Postgres CAS
 * semantics: `casActiveStreamId` only writes when `expected` matches the current
 * value (including the null case), and reports whether the write happened. */
function createFakeStore(initial: Record<string, string | null> = {}): {
  store: ThreadPointerStore
  casCalls: CasCall[]
  get: (threadId: string) => string | null
} {
  const pointers = new Map<string, string | null>(Object.entries(initial))
  const casCalls: CasCall[] = []
  const store: ThreadPointerStore = {
    async readActiveStreamId(threadId) {
      return pointers.get(threadId) ?? null
    },
    async casActiveStreamId(args) {
      casCalls.push(args)
      const current = pointers.get(args.threadId) ?? null
      if (current !== args.expected) return false
      pointers.set(args.threadId, args.next)
      return true
    },
  }
  return { store, casCalls, get: (threadId) => pointers.get(threadId) ?? null }
}

/** A racy variant: `readActiveStreamId` returns a caller-supplied stale
 * snapshot while the "real" pointer (what `casActiveStreamId` compares
 * against) has already moved on — simulating a second process winning the
 * race between our SELECT and our UPDATE. */
function createRacyStore(
  realPointer: string | null,
  staleObservedId: string | null,
): {
  store: ThreadPointerStore
  casCalls: CasCall[]
  get: () => string | null
} {
  let pointer = realPointer
  const casCalls: CasCall[] = []
  const store: ThreadPointerStore = {
    async readActiveStreamId() {
      return staleObservedId
    },
    async casActiveStreamId(args) {
      casCalls.push(args)
      if (pointer !== args.expected) return false
      pointer = args.next
      return true
    },
  }
  return { store, casCalls, get: () => pointer }
}

/** A `HermesStreaming` fake with call-count tracking for `has`/`resumeExistingStream`. */
function createFakeStreaming(opts: {
  has?: boolean
  resume?: () => Promise<ReadableStream<string> | null>
}): { streaming: HermesStreaming; resumeCallCount: () => number } {
  let resumeCalls = 0
  const streaming: HermesStreaming = {
    has: () => opts.has ?? false,
    async resumeExistingStream() {
      resumeCalls++
      if (!opts.resume) return null
      return opts.resume()
    },
  }
  return { streaming, resumeCallCount: () => resumeCalls }
}

/** A ReadableStream whose `cancel()` is observable, standing in for the probe
 * stream `isStreamLive` must cancel after confirming liveness. */
function createCancelTrackedStream(): {
  stream: ReadableStream<string>
  cancelCount: () => number
} {
  let cancelCount = 0
  const stream = new ReadableStream<string>({
    cancel() {
      cancelCount++
    },
  })
  return { stream, cancelCount: () => cancelCount }
}

describe('claimActiveStream', () => {
  it('CAS pinned on the observed value: a mismatch loses cleanly and does not clobber', async () => {
    // realPointer already moved to 'winner-stream' by a racing request between
    // our SELECT (which observed 'stale-observed') and our UPDATE.
    const { store, casCalls, get } = createRacyStore('winner-stream', 'stale-observed')
    const { streaming } = createFakeStreaming({ has: false, resume: async () => null })

    const claimed = await claimActiveStream({ store, streaming }, 'thr_1', 'new-stream')

    expect(claimed).toBe(false)
    expect(casCalls).toEqual([
      { threadId: 'thr_1', expected: 'stale-observed', next: 'new-stream' },
    ])
    expect(get()).toBe('winner-stream') // untouched, not clobbered
  })

  it('CAS on a null pointer takes the IS-NULL branch and claims successfully', async () => {
    const { store, casCalls, get } = createFakeStore()
    const { streaming, resumeCallCount } = createFakeStreaming({ has: false })

    const claimed = await claimActiveStream({ store, streaming }, 'thr_1', 'new-stream')

    expect(claimed).toBe(true)
    expect(casCalls).toEqual([{ threadId: 'thr_1', expected: null, next: 'new-stream' }])
    expect(get('thr_1')).toBe('new-stream')
    // No existing pointer -> liveness is never even consulted.
    expect(resumeCallCount()).toBe(0)
  })

  it('a genuinely live existing stream is left untouched (caller must 409, not supersede)', async () => {
    const { store, casCalls, get } = createFakeStore({ thr_1: 'live-stream' })
    const { streaming } = createFakeStreaming({ has: true })

    const claimed = await claimActiveStream({ store, streaming }, 'thr_1', 'new-stream')

    expect(claimed).toBe(false)
    expect(casCalls).toEqual([]) // never even attempts the CAS
    expect(get('thr_1')).toBe('live-stream')
  })
})

describe('isStreamLive', () => {
  it('tier 1 (has() true) short-circuits — resumeExistingStream is never called', async () => {
    const { streaming, resumeCallCount } = createFakeStreaming({ has: true })

    const live = await isStreamLive(streaming, 'strm_1')

    expect(live).toBe(true)
    expect(resumeCallCount()).toBe(0)
  })

  it('tier 2 live: resume resolves a stream -> true, and the probe stream is cancelled', async () => {
    const { stream, cancelCount } = createCancelTrackedStream()
    const { streaming } = createFakeStreaming({ has: false, resume: async () => stream })

    const live = await isStreamLive(streaming, 'strm_1')

    expect(live).toBe(true)
    expect(cancelCount()).toBe(1)
  })

  it('tier 2 dead: resume resolves null -> false', async () => {
    const { streaming } = createFakeStreaming({ has: false, resume: async () => null })

    const live = await isStreamLive(streaming, 'strm_1')

    expect(live).toBe(false)
  })

  it('tier 2 rejection: resume rejects -> resolves false, does not throw', async () => {
    const { streaming } = createFakeStreaming({
      has: false,
      resume: () => Promise.reject(new Error('ack timeout')),
    })

    await expect(isStreamLive(streaming, 'strm_1')).resolves.toBe(false)
  })
})

describe('resumeOrDead', () => {
  it('collapses a rejection into null instead of throwing', async () => {
    const { streaming } = createFakeStreaming({
      resume: () => Promise.reject(new Error('ack timeout')),
    })

    await expect(resumeOrDead(streaming, 'strm_1')).resolves.toBeNull()
  })

  it('passes through a resolved stream unchanged', async () => {
    const { stream } = createCancelTrackedStream()
    const { streaming } = createFakeStreaming({ resume: async () => stream })

    const resumed = await resumeOrDead(streaming, 'strm_1')

    expect(resumed).toBe(stream)
  })
})

describe('clearActiveStream', () => {
  it('AND-guarded: a superseded pointer is left intact (CAS matches zero rows)', async () => {
    const { store, casCalls, get } = createFakeStore({ thr_1: 'newer-stream' })

    await clearActiveStream(store, 'thr_1', 'stale-stream')

    expect(casCalls).toEqual([{ threadId: 'thr_1', expected: 'stale-stream', next: null }])
    expect(get('thr_1')).toBe('newer-stream') // untouched — not reaped
  })

  it('clears the pointer when it still matches streamId', async () => {
    const { store, get } = createFakeStore({ thr_1: 'stream-x' })

    await clearActiveStream(store, 'thr_1', 'stream-x')

    expect(get('thr_1')).toBeNull()
  })
})

describe('turnAlreadyPersisted', () => {
  it('true when the ledger reports the client_message_id already exists', async () => {
    const ledger = { hasClientMessage: async () => true }

    await expect(turnAlreadyPersisted(ledger, 'thr_1', 'msg_1')).resolves.toBe(true)
  })

  it('false when the ledger reports no matching row', async () => {
    const ledger = { hasClientMessage: async () => false }

    await expect(turnAlreadyPersisted(ledger, 'thr_1', 'msg_1')).resolves.toBe(false)
  })
})
