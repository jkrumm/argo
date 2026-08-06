import { describe, expect, it } from 'bun:test'
import type { ChatMessage } from 'basalt-ui/agent'
import type { HermesMessage, HermesThread } from '../../lib/queries/hermes'
import type { ThreadsMap } from './threads-store'

// threads-store.ts's module chain imports `lib/eden.ts`, which reads
// `window.location.origin` at module-evaluation time when VITE_API_URL is
// unset — there is no DOM under plain `bun test`. Setting VITE_API_URL here,
// before the dynamic import below triggers that evaluation, sidesteps it
// without faking `window` (same workaround the retired threads-adapter.test.ts
// used — `import.meta.env.*` reads live off `process.env` under bun).
process.env['VITE_API_URL'] = 'http://test.local/api'

const {
  appendMessageToMap,
  createThreadEntry,
  insertThread,
  markReadInMap,
  mergeOptimisticMessages,
  mergeServerThreads,
  removeFromMap,
  setOutcomeInMap,
  setResumeTokenInMap,
  setStatusInMap,
  sortThreadsNewestFirst,
  toChatMessage,
} = await import('./threads-store')

// This file replaces threads-adapter.test.ts's `hermesThreadsAdapter` suite —
// including basalt's `threadsStoreAdapterContract` conformance run — because
// this store no longer implements `ThreadsStoreAdapter` at all (that async,
// server-write contract is exactly what this rework retires; see
// threads-store.ts's header doc). `ThreadsStore` itself has no shipped
// conformance suite (its methods are synchronous, local state transitions), so
// these tests instead exercise the pure functions the hook is built from
// directly — no React rendering harness is available in this repo
// (`@testing-library/react` is not installed), so `useHermesThreads` itself is
// exercised only indirectly, through these functions.

function seedThread(overrides: Partial<HermesThread> = {}): HermesThread {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? crypto.randomUUID(),
    session_id: 'session-1',
    session_key: 'session-key-1',
    title: null,
    summary: null,
    type: null,
    status: 'active',
    pinned: 0,
    archived_at: null,
    created_at: now,
    updated_at: now,
    streaming: false,
    ...overrides,
  }
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    role: overrides.role ?? 'user',
    parts: overrides.parts ?? [],
    createdAt: overrides.createdAt ?? Date.now(),
    ...(overrides.finish !== undefined ? { finish: overrides.finish } : {}),
  }
}

// ── createThreadEntry / insertThread ────────────────────────────────────────

describe('createThreadEntry', () => {
  it('starts pending, unread, with no messages/outcome/resumeToken', () => {
    const thread = createThreadEntry('t1')
    expect(thread.status).toBe('pending')
    expect(thread.read).toBe(false)
    expect(thread.messages).toEqual([])
    expect(thread.outcome).toBeNull()
    expect(thread.resumeToken).toBeUndefined()
  })

  it('carries meta when provided', () => {
    const thread = createThreadEntry('t1', { meta: { source: 'test' } })
    expect(thread.meta).toEqual({ source: 'test' })
  })
})

describe('insertThread', () => {
  it('adds the thread, keyed by id', () => {
    const map = insertThread(new Map(), createThreadEntry('t1'))
    expect(map.has('t1')).toBe(true)
  })
})

// ── local setters ────────────────────────────────────────────────────────────

describe('appendMessageToMap', () => {
  it('appends to an existing thread and bumps updatedAt', () => {
    const thread = createThreadEntry('t1')
    const map: ThreadsMap = new Map([['t1', thread]])
    const msg = message({ id: 'm1' })
    const next = appendMessageToMap(map, 't1', msg)
    expect(next.get('t1')?.messages).toEqual([msg])
    expect(next.get('t1')?.updatedAt).toBeGreaterThanOrEqual(thread.updatedAt)
  })

  it('is a no-op for an unknown thread id', () => {
    const map: ThreadsMap = new Map()
    const next = appendMessageToMap(map, 'missing', message())
    expect(next).toBe(map)
  })

  it('preserves append order across two calls', () => {
    let map: ThreadsMap = new Map([['t1', createThreadEntry('t1')]])
    map = appendMessageToMap(map, 't1', message({ id: 'm1' }))
    map = appendMessageToMap(map, 't1', message({ id: 'm2' }))
    expect(map.get('t1')?.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('setStatusInMap', () => {
  it('round-trips status', () => {
    const map: ThreadsMap = new Map([['t1', createThreadEntry('t1')]])
    const next = setStatusInMap(map, 't1', 'streaming')
    expect(next.get('t1')?.status).toBe('streaming')
  })
})

describe('setOutcomeInMap', () => {
  it('round-trips outcome', () => {
    const map: ThreadsMap = new Map([['t1', createThreadEntry('t1')]])
    const outcome = { title: 'Title', summary: 'Summary', status: 'done' as const }
    const next = setOutcomeInMap(map, 't1', outcome)
    expect(next.get('t1')?.outcome).toEqual(outcome)
  })
})

describe('setResumeTokenInMap', () => {
  it('sets and clears with undefined', () => {
    let map: ThreadsMap = new Map([['t1', createThreadEntry('t1')]])
    map = setResumeTokenInMap(map, 't1', 'tok-1')
    expect(map.get('t1')?.resumeToken).toBe('tok-1')
    map = setResumeTokenInMap(map, 't1', undefined)
    expect(map.get('t1')?.resumeToken).toBeUndefined()
  })
})

describe('markReadInMap', () => {
  it('marks the thread read', () => {
    const map: ThreadsMap = new Map([['t1', createThreadEntry('t1')]])
    expect(map.get('t1')?.read).toBe(false)
    const next = markReadInMap(map, 't1')
    expect(next.get('t1')?.read).toBe(true)
  })
})

describe('removeFromMap', () => {
  it('removes the thread', () => {
    const map: ThreadsMap = new Map([['t1', createThreadEntry('t1')]])
    const next = removeFromMap(map, 't1')
    expect(next.has('t1')).toBe(false)
  })

  it('is a no-op for an unknown id', () => {
    const map: ThreadsMap = new Map()
    expect(removeFromMap(map, 'missing')).toBe(map)
  })
})

// ── sortThreadsNewestFirst ───────────────────────────────────────────────────

describe('sortThreadsNewestFirst', () => {
  it('orders by updatedAt descending', () => {
    const map: ThreadsMap = new Map([
      ['older', { ...createThreadEntry('older'), updatedAt: 1 }],
      ['newest', { ...createThreadEntry('newest'), updatedAt: 3 }],
      ['middle', { ...createThreadEntry('middle'), updatedAt: 2 }],
    ])
    expect(sortThreadsNewestFirst(map).map((t) => t.id)).toEqual(['newest', 'middle', 'older'])
  })
})

// ── mergeServerThreads — the thread-list upsert-by-id ───────────────────────

describe('mergeServerThreads', () => {
  it('seeds a brand-new thread from a server row', () => {
    const row = seedThread({ id: 't1', title: 'Hello', pinned: 1 })
    const next = mergeServerThreads(new Map(), [row])
    const thread = next.get('t1')
    expect(thread).toBeDefined()
    expect(thread?.status).toBe('done')
    expect(thread?.resumeToken).toBeUndefined()
    expect(thread?.meta).toMatchObject({ title: 'Hello', pinned: true })
  })

  it('maps a streaming row to status "streaming" with a defined resumeToken', () => {
    const row = seedThread({ id: 't1', streaming: true })
    const next = mergeServerThreads(new Map(), [row])
    expect(next.get('t1')?.status).toBe('streaming')
    expect(next.get('t1')?.resumeToken).toBeDefined()
  })

  it('seeds eager messages for a streaming thread when supplied', () => {
    const row = seedThread({ id: 't1', streaming: true })
    const msgs = [message({ id: 'm1', role: 'user' })]
    const next = mergeServerThreads(new Map(), [row], new Map([['t1', msgs]]))
    expect(next.get('t1')?.messages).toEqual(msgs)
  })

  it('does NOT clobber a locally-owned status/messages/resumeToken on a later refetch — only meta updates', () => {
    // The local thread is already 'streaming' (this store started the turn itself) with an
    // optimistic message appended and a resumeToken set — a subsequent threads-list refetch
    // must not blow any of that away; it is not the source of truth for run lifecycle.
    const local = {
      ...createThreadEntry('t1'),
      status: 'streaming' as const,
      resumeToken: 't1',
      messages: [message({ id: 'optimistic' })],
    }
    const map: ThreadsMap = new Map([['t1', local]])
    // Server hasn't caught up yet: still reports not-streaming (e.g. the lazy row was only just
    // created, `active_stream_id` not yet visible in this particular read).
    const row = seedThread({ id: 't1', streaming: false, title: 'A title' })

    const next = mergeServerThreads(map, [row])
    const thread = next.get('t1')
    expect(thread?.status).toBe('streaming')
    expect(thread?.resumeToken).toBe('t1')
    expect(thread?.messages).toEqual(local.messages)
    expect(thread?.meta).toMatchObject({ title: 'A title' })
  })

  it('takes the more recent of local and server updatedAt', () => {
    const local = { ...createThreadEntry('t1'), updatedAt: 1000 }
    const map: ThreadsMap = new Map([['t1', local]])
    const row = seedThread({ id: 't1', updated_at: new Date(2000).toISOString() })
    const next = mergeServerThreads(map, [row])
    expect(next.get('t1')?.updatedAt).toBe(2000)
  })
})

// ── mergeOptimisticMessages — the message-level dedupe ──────────────────────

describe('mergeOptimisticMessages', () => {
  it('shows an optimistic user message immediately on a fresh thread whose messages query resolved empty', () => {
    // No confirmed messages yet (a brand-new thread's 404-turned-empty-success), and
    // `hermesFetch` hasn't recorded an outbound id yet either (the fetch is still in
    // flight) — the optimistic message must still render.
    const userMsg = message({ id: 'optimistic-user', role: 'user', createdAt: 1000 })
    const result = mergeOptimisticMessages([], [userMsg], new Set(), [])
    expect(result).toEqual([userMsg])
  })

  it('keeps the optimistic user message once its wire id has been recorded but not yet confirmed', () => {
    const userMsg = message({ id: 'optimistic-user', role: 'user', createdAt: 1000 })
    const result = mergeOptimisticMessages([], [userMsg], new Set(), ['wire-id-1'])
    expect(result).toEqual([userMsg])
  })

  it('drops the optimistic user message once its wire id is confirmed — no duplicate', () => {
    const serverMsg = message({ id: 'server-row-1', role: 'user', createdAt: 1000 })
    const optimisticMsg = message({ id: 'optimistic-user', role: 'user', createdAt: 1000 })
    // `optimisticMsg.id` never appears anywhere — the confirmation key is the wire id
    // `hermesFetch` recorded for this turn, paired by POSITION, not by ChatMessage.id.
    const result = mergeOptimisticMessages([serverMsg], [optimisticMsg], new Set(['wire-id-1']), [
      'wire-id-1',
    ])
    expect(result).toEqual([serverMsg])
    expect(result).toHaveLength(1)
  })

  it('pairs multiple user turns by position, dropping only the confirmed ones', () => {
    const serverTurn1 = message({ id: 'server-1', role: 'user', createdAt: 1000 })
    const optimisticTurn1 = message({ id: 'optimistic-1', role: 'user', createdAt: 1000 })
    const optimisticTurn2 = message({ id: 'optimistic-2', role: 'user', createdAt: 2000 })
    const result = mergeOptimisticMessages(
      [serverTurn1],
      [optimisticTurn1, optimisticTurn2],
      new Set(['wire-1']), // only the first turn's wire id has landed in the confirmed transcript
      ['wire-1', 'wire-2'],
    )
    expect(result).toEqual([serverTurn1, optimisticTurn2])
  })

  it('does not duplicate the assistant message despite having no client id at all', () => {
    // The assistant message is only ever appended locally once its row is already
    // durably persisted server-side — dedup is by CONFIRMED COUNT, not by id.
    const serverAssistant = message({ id: 'srv-msg-9', role: 'assistant', createdAt: 1500 })
    const optimisticAssistant = message({ id: 'client-msg-9', role: 'assistant', createdAt: 1500 })
    const result = mergeOptimisticMessages([serverAssistant], [optimisticAssistant], new Set(), [])
    expect(result).toEqual([serverAssistant])
    expect(result.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })

  it('keeps an optimistic assistant message the confirmed transcript has not caught up to yet', () => {
    const optimisticAssistant = message({ id: 'client-msg-1', role: 'assistant', createdAt: 3000 })
    const result = mergeOptimisticMessages([], [optimisticAssistant], new Set(), [])
    expect(result).toEqual([optimisticAssistant])
  })

  it('never renders both or neither across a full turn — user then assistant confirmation in sequence', () => {
    const userMsg = message({ id: 'opt-user', role: 'user', createdAt: 1000 })
    const assistantMsg = message({ id: 'opt-assistant', role: 'assistant', createdAt: 1500 })
    const overlay = [userMsg, assistantMsg]

    // Mid-turn: neither is confirmed yet — both render exactly once via the overlay.
    const midTurn = mergeOptimisticMessages([], overlay, new Set(), ['wire-1'])
    expect(midTurn).toEqual(overlay)

    // Turn finished: the confirmed fetch now has both rows.
    const serverUser = message({ id: 'srv-user', role: 'user', createdAt: 1000 })
    const serverAssistant = message({ id: 'srv-assistant', role: 'assistant', createdAt: 1500 })
    const settled = mergeOptimisticMessages(
      [serverUser, serverAssistant],
      overlay,
      new Set(['wire-1']),
      ['wire-1'],
    )
    expect(settled).toEqual([serverUser, serverAssistant])
    expect(settled).toHaveLength(2)
  })

  // ── Defect 1 regression: reload / cross-tab open / resume duplicates messages ──

  it('renders a seeded confirmed transcript exactly once with an EMPTY outbound-id map — the reload case', () => {
    // `useHermesThreads`'s hydration effect seeds `AgentThread.messages` (the overlay) with the
    // FULL confirmed transcript for a streaming thread, so it can appear as BOTH `serverMessages`
    // AND `overlay`, carrying the SAME id — `outboundClientMessageIds` is empty because it's a
    // per-tab, in-memory map that hasn't recorded anything after a reload/cross-tab open. Without
    // the id-based first pass, this renders the same row twice (the observed bug).
    const seeded = message({ id: 'srv-user-row', role: 'user', createdAt: 1000 })
    const result = mergeOptimisticMessages([seeded], [seeded], new Set(), [])
    expect(result).toEqual([seeded])
    expect(result).toHaveLength(1)
  })

  it('after a seeded reload, a NEW send renders exactly once, not twice — the cascade case', () => {
    // The seeded duplicate above, left unfiltered, would occupy overlay slot 0 and permanently
    // misalign every later positional pairing — a genuinely new send would (wrongly) pair against
    // `outboundClientMessageIds[1]`, which never fills. With the id-based first pass, the seeded
    // entry never reaches the positional logic at all, so the new send pairs at position 0 as normal.
    const seeded = message({ id: 'srv-user-row', role: 'user', createdAt: 1000 })
    const newOptimistic = message({ id: 'agent-message-new', role: 'user', createdAt: 2000 })
    const result = mergeOptimisticMessages([seeded], [seeded, newOptimistic], new Set(), [
      'wire-new',
    ])
    expect(result).toEqual([seeded, newOptimistic])
    expect(result.filter((m) => m.id === 'srv-user-row')).toHaveLength(1)
  })

  // ── Defect 2 regression: a rejected turn must not leave a permanent phantom bubble ──

  it('drops an optimistic user message whose wire id was recorded as FAILED — a rejected turn', () => {
    // A 409/503/401/network-throw never reaches `confirmedClientMessageIds` (the server never
    // persisted it), so the "never confirmed -> always keep" rule would otherwise keep this
    // bubble forever. `failedClientMessageIds` overrides that.
    const userMsg = message({ id: 'optimistic-user', role: 'user', createdAt: 1000 })
    const result = mergeOptimisticMessages(
      [],
      [userMsg],
      new Set(),
      ['wire-failed'],
      new Set(['wire-failed']),
    )
    expect(result).toEqual([])
  })

  it('keeps an optimistic user message for a STOPPED (aborted) turn — Stop is not a failure', () => {
    // hermesFetch never records an AbortError as failed — an aborted turn's wire id is outbound
    // but never lands in failedClientMessageIds, so the message must still render.
    const userMsg = message({ id: 'optimistic-user', role: 'user', createdAt: 1000 })
    const result = mergeOptimisticMessages([], [userMsg], new Set(), ['wire-stopped'], new Set())
    expect(result).toEqual([userMsg])
  })
})

// ── toChatMessage — server row → basalt shape ───────────────────────────────

function seedMessage(overrides: Partial<HermesMessage> = {}): HermesMessage {
  return {
    id: overrides.id ?? 'msg-1',
    thread_id: 'thread-1',
    role: overrides.role ?? 'assistant',
    status: overrides.status ?? 'complete',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    payload: null,
    parts: overrides.parts ?? [],
    client_message_id: overrides.client_message_id ?? null,
  }
}

describe('toChatMessage', () => {
  it('returns null for a system row', () => {
    expect(toChatMessage(seedMessage({ role: 'system' }))).toBeNull()
  })

  it('maps a persisted dynamic-tool part to a basalt tool part', () => {
    const row = seedMessage({
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'run-1:0',
          toolName: 'search',
          state: 'output-available',
          input: { query: 'hermes' },
          output: { results: [] },
        },
      ],
    })
    const result = toChatMessage(row)
    expect(result?.parts).toHaveLength(1)
    expect(result?.parts[0]).toMatchObject({
      type: 'tool',
      toolCallId: 'run-1:0',
      toolName: 'search',
      state: 'output-available',
    })
  })

  it('maps status to ChatMessage.finish for an assistant row', () => {
    expect(toChatMessage(seedMessage({ status: 'complete' }))?.finish).toBe('complete')
    expect(toChatMessage(seedMessage({ status: 'interrupted' }))?.finish).toBe('stopped')
    expect(toChatMessage(seedMessage({ status: 'error' }))?.finish).toBe('error')
  })

  it('never sets finish on a user row', () => {
    expect(toChatMessage(seedMessage({ role: 'user', status: 'complete' }))?.finish).toBeUndefined()
  })
})
