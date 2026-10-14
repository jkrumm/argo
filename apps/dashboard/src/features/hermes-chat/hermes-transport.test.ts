import { describe, expect, mock, test } from 'bun:test'

// bun test has no DOM; `lib/api-base.ts` reads `window.location.origin` at import.
Object.assign(globalThis, { window: { location: { origin: 'http://localhost' } } })

const emitted: Array<{ kind: string; payload: unknown; opts: unknown }> = []
await mock.module('basalt-ui/commands', () => ({
  emit: (kind: string, payload: unknown, opts: unknown) => {
    emitted.push({ kind, payload, opts })
  },
}))

const { isRejectedTurnError, notifyHermesChatError } = await import('./hermes-transport')

// What AI SDK's `APICallError` looks like when it reaches `useAgentThreadRuns({ onError })`:
// the response text is the message, the status rides on `statusCode`.
const http = (statusCode: number, body: string) =>
  Object.assign(new Error(body), { statusCode, responseBody: body })

describe('hermes chat failures, by AgentError kind', () => {
  test('http 409 stream_in_progress / duplicate_turn roll the optimistic bubble back', () => {
    const body = (error: string) => JSON.stringify({ error, message: 'nope' })
    expect(isRejectedTurnError(http(409, body('stream_in_progress')))).toBe(true)
    expect(isRejectedTurnError(http(409, body('duplicate_turn')))).toBe(true)
    expect(isRejectedTurnError(http(503, body('hermes_unconfigured')))).toBe(false)
  })

  test('only http can be a rejected turn', () => {
    const json = JSON.stringify({ error: 'duplicate_turn', message: 'x' })
    expect(isRejectedTurnError(new Error(json))).toBe(false) // no statusCode → server kind
    expect(
      isRejectedTurnError(Object.assign(new Error('x'), { chunkType: 't', chunkId: 'i' })),
    ).toBe(false)
    expect(isRejectedTurnError(new DOMException('stop', 'AbortError'))).toBe(false)
  })

  test('http with a structured body toasts the server copy under its title', () => {
    emitted.length = 0
    notifyHermesChatError(
      http(409, JSON.stringify({ error: 'stream_in_progress', message: 'Hermes is replying.' })),
    )
    expect(emitted).toEqual([
      {
        kind: 'chat:error',
        payload: { message: 'Hermes is replying.' },
        opts: { title: 'Already generating' },
      },
    ])
  })

  test('http 401 plain text asks for a new sign-in', () => {
    emitted.length = 0
    notifyHermesChatError(http(401, 'Unauthorized'))
    expect(emitted[0]?.payload).toEqual({ message: 'Your session has expired — sign in again.' })
  })

  test('server (mid-stream error chunk) surfaces its message; stream surfaces a fixed line', () => {
    emitted.length = 0
    notifyHermesChatError(new Error('upstream exploded'))
    notifyHermesChatError(
      Object.assign(new Error('bad'), { chunkType: 'text-delta', chunkId: 'a' }),
    )
    expect(emitted.map((e) => e.payload)).toEqual([
      { message: 'upstream exploded' },
      { message: 'The reply stream was malformed and was cut off.' },
    ])
  })

  test('aborted emits nothing', () => {
    emitted.length = 0
    notifyHermesChatError(new DOMException('stop', 'AbortError'))
    expect(emitted).toEqual([])
  })
})
