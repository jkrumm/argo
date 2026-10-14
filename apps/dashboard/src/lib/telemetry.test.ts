import { describe, expect, test } from 'bun:test'
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api'
import type { BasaltEvent } from 'basalt-ui'

import { telemetry } from './telemetry'

type Recorded = {
  name: string
  startTime: number | undefined
  attributes: Record<string, unknown> | undefined
  status?: { code: SpanStatusCode }
  endTime?: number
}

const recorded: Recorded[] = []
let ended = false

const fakeProvider = {
  getTracer: () => ({
    startSpan: (name: string, options?: Recorded) => {
      const record: Recorded = {
        name,
        startTime: options?.startTime,
        attributes: options?.attributes,
      }
      recorded.push(record)
      return {
        setAttributes: (attrs: Record<string, unknown>) => {
          record.attributes = { ...record.attributes, ...attrs }
        },
        setStatus: (status: { code: SpanStatusCode }) => {
          record.status = status
        },
        spanContext: () => ({
          traceId: '0af7651916cd43dd8448eb211c80319c',
          spanId: 'b7ad6b7169203331',
          traceFlags: 1,
        }),
        end: (endTime?: number) => {
          record.endTime = endTime
          ended = true
        },
      } as unknown as Span
    },
  }),
}

const navigate: BasaltEvent = {
  type: 'route.navigate',
  failed: false,
  start: 1000,
  duration: 25,
  attributes: { 'basalt.route.id': '/health', 'basalt.route.from': '/', 'url.path': '/health' },
}

const queryError: BasaltEvent = {
  type: 'query.error',
  failed: true,
  start: 2000,
  attributes: {
    'basalt.query.hash': 'abc',
    'basalt.query.failure_count': 2,
    'exception.type': 'Error',
    'basalt.error.kind': 'network',
  } as never,
}

// The global provider can be set once per process, so the inert case must run first.
describe('telemetry sink', () => {
  test('is inert before a provider is registered', () => {
    expect(() => telemetry(navigate)).not.toThrow()
    const turn = telemetry.startChatTurn?.({ threadId: 't0', messageId: 'm0' })
    expect(turn?.headers).toBeUndefined()
    expect(() => turn?.settle?.('settled')).not.toThrow()
    expect(() => telemetry(queryError)).not.toThrow()
    expect(recorded).toHaveLength(0)
  })

  test('registered provider receives spans', () => {
    expect(trace.setGlobalTracerProvider(fakeProvider as never)).toBe(true)

    telemetry(navigate)
    expect(recorded.at(-1)).toEqual({
      name: 'route.navigate',
      startTime: 1000,
      attributes: navigate.attributes,
      endTime: 1025,
    })
  })

  test('failed event sets ERROR status and, without duration, ends at start', () => {
    telemetry(queryError)
    expect(recorded.at(-1)).toMatchObject({
      name: 'query.error',
      startTime: 2000,
      status: { code: SpanStatusCode.ERROR },
      endTime: 2000,
    })
  })

  test('chat.turn event decorates the open turn span instead of adding one', () => {
    const turn = telemetry.startChatTurn?.({ threadId: 't2', messageId: 'm2' })
    const count = recorded.length
    ended = false
    telemetry({
      type: 'chat.turn',
      failed: true,
      start: 3000,
      duration: 40,
      attributes: {
        'basalt.chat.thread_id': 't2',
        'basalt.chat.ttft_ms': 5,
        'basalt.chat.parts': 1,
      },
    } as never)
    expect(recorded).toHaveLength(count)
    expect(recorded.at(-1)).toMatchObject({
      name: 'chat.turn',
      attributes: { 'basalt.chat.ttft_ms': 5, 'basalt.chat.parts': 1 },
      status: { code: SpanStatusCode.ERROR },
    })
    expect(ended).toBe(false)
    turn?.settle?.('failed')
    expect(ended).toBe(true)
  })

  test('chat.turn event without an open turn (resume) emits its own span', () => {
    const count = recorded.length
    telemetry({
      type: 'chat.turn',
      failed: false,
      start: 4000,
      duration: 10,
      attributes: { 'basalt.chat.thread_id': 'resumed' },
    } as never)
    expect(recorded).toHaveLength(count + 1)
    expect(recorded.at(-1)).toMatchObject({ name: 'chat.turn', startTime: 4000, endTime: 4010 })
  })

  test('settle clears the open turn, also when stopped', () => {
    const turn = telemetry.startChatTurn?.({ threadId: 't3', messageId: 'm3' })
    turn?.settle?.('stopped')
    const count = recorded.length
    telemetry({
      type: 'chat.turn',
      failed: false,
      start: 5000,
      duration: 1,
      attributes: { 'basalt.chat.thread_id': 't3' },
    } as never)
    expect(recorded).toHaveLength(count + 1)
  })

  test('startChatTurn returns a W3C traceparent and settle ends the span', () => {
    const turn = telemetry.startChatTurn?.({ threadId: 't1', messageId: 'm1' })
    expect(turn?.headers?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    expect(recorded.at(-1)).toMatchObject({
      name: 'chat.turn',
      attributes: { 'basalt.chat.thread_id': 't1' },
    })
    expect(recorded.at(-1)?.endTime).toBeUndefined()
    turn?.settle?.('failed')
    expect(recorded.at(-1)?.status).toEqual({ code: SpanStatusCode.ERROR })
    expect(ended).toBe(true)
  })
})
