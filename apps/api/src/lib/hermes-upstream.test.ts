import { describe, it, expect } from 'bun:test'
// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5; type-only import to build UIMessage part fixtures for buildHermesMessageContent (docs/HERMES-CHAT-V2.md).
import type { UIMessage } from 'ai'
import {
  buildHermesMessageContent,
  ensureHermesSession,
  openHermesChatStream,
  HermesContentError,
  HermesUpstreamError,
  type FetchImpl,
} from './hermes-upstream.js'

// Pure unit tests — no database, no network. Every fixture below is a
// hand-built fake `FetchImpl`; no real Hermes instance is involved.

interface CapturedRequest {
  url: string
  method: string | undefined
  headers: Headers
  body: string | undefined
}

/** Build a fake transport that records every call and answers with `respond`. */
function fakeFetch(respond: (req: CapturedRequest) => Response): {
  fetchImpl: FetchImpl
  calls: CapturedRequest[]
} {
  const calls: CapturedRequest[] = []
  const fetchImpl: FetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
    const req: CapturedRequest = {
      url,
      method: init?.method ?? (input instanceof Request ? input.method : undefined),
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    calls.push(req)
    return Promise.resolve(respond(req))
  }
  return { fetchImpl, calls }
}

describe('ensureHermesSession', () => {
  it('resolves on 201 (created)', async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 201 }))
    await expect(
      ensureHermesSession({
        fetchImpl,
        baseURL: 'http://hermes.test/v1',
        apiKey: 'key',
        sessionId: 'ses_1',
      }),
    ).resolves.toBeUndefined()
  })

  it('resolves on 409 (session_exists) — treated as success', async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'exists', code: 'session_exists' } }), {
          status: 409,
        }),
    )
    await expect(
      ensureHermesSession({
        fetchImpl,
        baseURL: 'http://hermes.test/v1',
        apiKey: 'key',
        sessionId: 'ses_1',
      }),
    ).resolves.toBeUndefined()
  })

  it('throws HermesUpstreamError with the parsed message on a 500', async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: 'db unavailable', type: 'server_error' } }),
          {
            status: 500,
          },
        ),
    )
    const promise = ensureHermesSession({
      fetchImpl,
      baseURL: 'http://hermes.test/v1',
      apiKey: 'key',
      sessionId: 'ses_1',
    })
    await expect(promise).rejects.toThrow(HermesUpstreamError)
    await promise.catch((error: unknown) => {
      expect(error).toBeInstanceOf(HermesUpstreamError)
      expect((error as HermesUpstreamError).status).toBe(500)
      expect((error as HermesUpstreamError).message).toBe('db unavailable')
    })
  })

  it('falls back to a generic message on a non-JSON error body', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('not json', { status: 502 }))
    const promise = ensureHermesSession({
      fetchImpl,
      baseURL: 'http://hermes.test/v1',
      apiKey: 'key',
      sessionId: 'ses_1',
    })
    await promise.catch((error: unknown) => {
      expect(error).toBeInstanceOf(HermesUpstreamError)
      expect((error as HermesUpstreamError).status).toBe(502)
      expect((error as HermesUpstreamError).message).toBe('Hermes upstream returned 502')
    })
  })

  it('POSTs the exact request shape: origin-derived URL (not under /v1), method, headers, body', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 201 }))
    await ensureHermesSession({
      fetchImpl,
      baseURL: 'http://hermes.test:8642/v1',
      apiKey: 'super-secret',
      sessionId: 'ses_shape',
    })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('http://hermes.test:8642/api/sessions')
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('authorization')).toBe('Bearer super-secret')
    expect(call?.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(call?.body ?? '')).toEqual({ id: 'ses_shape', source: 'api_server' })
  })
})

describe('openHermesChatStream', () => {
  it('returns the response on 200', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    const { fetchImpl } = fakeFetch(
      () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    const res = await openHermesChatStream({
      fetchImpl,
      baseURL: 'http://hermes.test/v1',
      apiKey: 'key',
      sessionId: 'ses_1',
      message: 'hi',
      systemMessage: 'system',
    })
    expect(res.status).toBe(200)
  })

  it('throws HermesUpstreamError on a non-200 with the parsed OpenAI-envelope message', async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: 'session_not_found', code: 'not_found' } }),
          {
            status: 404,
          },
        ),
    )
    const promise = openHermesChatStream({
      fetchImpl,
      baseURL: 'http://hermes.test/v1',
      apiKey: 'key',
      sessionId: 'ses_1',
      message: 'hi',
      systemMessage: 'system',
    })
    await promise.catch((error: unknown) => {
      expect(error).toBeInstanceOf(HermesUpstreamError)
      expect((error as HermesUpstreamError).status).toBe(404)
      expect((error as HermesUpstreamError).message).toBe('session_not_found')
      expect((error as HermesUpstreamError).code).toBe('not_found')
    })
  })

  it('POSTs the exact request shape: URL (origin + session path), headers, body — no X-Hermes-Session-Id', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 200 }))
    await openHermesChatStream({
      fetchImpl,
      baseURL: 'http://hermes.test:8642/v1',
      apiKey: 'super-secret',
      sessionId: 'ses_shape',
      sessionKey: 'agent:main:key',
      message: 'hello there',
      systemMessage: 'be terse',
      model: 'hermes',
    })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('http://hermes.test:8642/api/sessions/ses_shape/chat/stream')
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('authorization')).toBe('Bearer super-secret')
    expect(call?.headers.get('content-type')).toBe('application/json')
    expect(call?.headers.get('x-hermes-session-key')).toBe('agent:main:key')
    expect(call?.headers.has('x-hermes-session-id')).toBe(false)
    expect(JSON.parse(call?.body ?? '')).toEqual({
      message: 'hello there',
      system_message: 'be terse',
      model: 'hermes',
    })
  })

  it('omits X-Hermes-Session-Key and model when not provided', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 200 }))
    await openHermesChatStream({
      fetchImpl,
      baseURL: 'http://hermes.test/v1',
      apiKey: 'key',
      sessionId: 'ses_1',
      message: 'hi',
      systemMessage: 'system',
    })
    const [call] = calls
    expect(call?.headers.has('x-hermes-session-key')).toBe(false)
    expect(JSON.parse(call?.body ?? '')).toEqual({ message: 'hi', system_message: 'system' })
  })
})

const textPart = (text: string): UIMessage['parts'][number] => ({ type: 'text', text })

describe('buildHermesMessageContent', () => {
  it('collapses text-only parts to a plain string', () => {
    const parts = [textPart('Hello '), textPart('world')]
    expect(buildHermesMessageContent(parts)).toBe('Hello world')
  })

  it('maps an image file part to an image_url content part', () => {
    const parts: UIMessage['parts'] = [
      textPart('describe this'),
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
    ]
    expect(buildHermesMessageContent(parts)).toEqual([
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: 'data:image/png;base64,AAAA' },
    ])
  })

  it('throws HermesContentError on a non-image file part, without dropping it silently', () => {
    const parts: UIMessage['parts'] = [
      textPart('see attached'),
      { type: 'file', mediaType: 'application/pdf', url: 'data:application/pdf;base64,AAAA' },
    ]
    expect(() => buildHermesMessageContent(parts)).toThrow(HermesContentError)
    expect(() => buildHermesMessageContent(parts)).toThrow(/application\/pdf/)
  })

  it('skips non-text/non-file parts (e.g. step-start) without error', () => {
    const parts: UIMessage['parts'] = [{ type: 'step-start' }, textPart('hi')]
    expect(buildHermesMessageContent(parts)).toBe('hi')
  })

  it('returns an empty string for an empty parts array', () => {
    expect(buildHermesMessageContent([])).toBe('')
  })
})
