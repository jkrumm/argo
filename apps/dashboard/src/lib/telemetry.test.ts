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
  ended?: boolean
}

const recorded: Recorded[] = []

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
        end: (endTime?: number) => {
          record.endTime = endTime
          record.ended = true
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
      ended: true,
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
})
