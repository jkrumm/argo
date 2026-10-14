import { describe, expect, it } from 'bun:test'
import { hermesTraceAttributes } from './hermes-trace.js'

// Pure unit test — no DB, no network.

describe('hermesTraceAttributes', () => {
  it('carries the request thread id under both the argo and basalt keys', () => {
    const attributes = hermesTraceAttributes({
      threadId: 'thr_123',
      streamId: 'str_456',
      sessionId: 'ses_789',
    })

    expect(attributes['argo.hermes.thread_id']).toBe('thr_123')
    expect(attributes['basalt.chat.thread_id']).toBe('thr_123')
    expect(attributes['basalt.chat.thread_id']).toBe(attributes['argo.hermes.thread_id'])
    expect(attributes['argo.hermes.stream_id']).toBe('str_456')
    expect(attributes['argo.hermes.session_id']).toBe('ses_789')
  })
})
