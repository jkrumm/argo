import { describe, it, expect } from 'bun:test'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import {
  redactHeaderAttributes,
  REDACTED_HEADER_NAMES,
  resourceAttributes,
  ScrubbingSpanProcessor,
} from './telemetry.js'

describe('resourceAttributes', () => {
  const base = {
    serviceName: 'argo-api',
    serviceVersion: '0123456789abcdef0123456789abcdef01234567',
    nodeEnv: 'production' as const,
    hostName: 'mini',
  }

  it('sets the contract namespace, prod environment name, short version and host', () => {
    expect(resourceAttributes(base)).toEqual({
      'service.name': 'argo-api',
      'service.namespace': 'argo',
      'service.version': '0123456',
      'deployment.environment.name': 'prod',
      'host.name': 'mini',
    })
  })

  it('maps every non-production mode to dev and omits host.name when unset', () => {
    const attributes = resourceAttributes({ ...base, nodeEnv: 'development', hostName: '' })
    expect(attributes['deployment.environment.name']).toBe('dev')
    expect(attributes).not.toHaveProperty('host.name')
    expect(attributes).not.toHaveProperty('deployment.environment')
  })
})

describe('redactHeaderAttributes', () => {
  it('redacts http.request.header.authorization', () => {
    const result = redactHeaderAttributes({
      'http.request.header.authorization': 'Bearer test-token',
    })
    expect(result['http.request.header.authorization']).toBe('[redacted]')
  })

  it('matches header names case-insensitively', () => {
    const result = redactHeaderAttributes({
      'HTTP.REQUEST.HEADER.Authorization': 'Bearer test-token',
    })
    expect(result['HTTP.REQUEST.HEADER.Authorization']).toBe('[redacted]')
  })

  it('redacts request cookie and response set-cookie', () => {
    const result = redactHeaderAttributes({
      'http.request.header.cookie': 'session=abc123',
      'http.response.header.set-cookie': 'session=abc123; Path=/',
    })
    expect(result['http.request.header.cookie']).toBe('[redacted]')
    expect(result['http.response.header.set-cookie']).toBe('[redacted]')
  })

  it('redacts any header whose name contains token or secret', () => {
    const result = redactHeaderAttributes({
      'http.request.header.x-refresh-token': 'abc',
      'http.response.header.x-webhook-secret': 'xyz',
    })
    expect(result['http.request.header.x-refresh-token']).toBe('[redacted]')
    expect(result['http.response.header.x-webhook-secret']).toBe('[redacted]')
  })

  it('redacts a referer that names a document or its filters, and keeps any other', () => {
    const referer = (value: string) =>
      redactHeaderAttributes({ 'http.request.header.referer': value })[
        'http.request.header.referer'
      ]
    expect(referer('https://argo.example.com/documents/2026-Acme')).toBe('[redacted]')
    expect(referer('https://argo.example.com/documents?issuer=Acme')).toBe('[redacted]')
    expect(referer('https://argo.example.com/documents')).toBe('https://argo.example.com/documents')
    expect(referer('https://argo.example.com/calendar')).toBe('https://argo.example.com/calendar')
  })

  it('leaves useful attributes untouched', () => {
    const attributes = {
      'http.route': '/workouts/:id',
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'url.full': 'https://argo.jkrumm.com/api/workouts/1',
      'client.address': '10.0.0.1',
    }
    const result = redactHeaderAttributes(attributes)
    expect(result).toEqual(attributes)
  })

  it('returns the same object reference when nothing is sensitive', () => {
    const attributes = { 'http.route': '/health', 'http.request.method': 'GET' }
    const result = redactHeaderAttributes(attributes)
    expect(result).toBe(attributes)
  })

  it('does not crash on non-string attribute values', () => {
    const attributes = {
      'http.response.status_code': 200,
      'http.request.header.x-forwarded-for': ['10.0.0.1', '10.0.0.2'],
      'http.request.header.x-api-key': true,
    }
    expect(() => redactHeaderAttributes(attributes)).not.toThrow()
    const result = redactHeaderAttributes(attributes)
    expect(result['http.request.header.x-api-key']).toBe('[redacted]')
    expect(result['http.response.status_code']).toBe(200)
  })

  it('keeps the header key but redacts the value', () => {
    const result = redactHeaderAttributes({ 'http.request.header.authorization': 'Bearer x' })
    expect(Object.keys(result)).toContain('http.request.header.authorization')
  })

  it('exports the redacted header name list for greppability', () => {
    expect(REDACTED_HEADER_NAMES.has('authorization')).toBe(true)
    expect(REDACTED_HEADER_NAMES.has('cookie')).toBe(true)
    expect(REDACTED_HEADER_NAMES.has('set-cookie')).toBe(true)
    expect(REDACTED_HEADER_NAMES.has('x-api-key')).toBe(true)
  })
})

describe('ScrubbingSpanProcessor', () => {
  function scrub(attributes: Record<string, unknown>): Record<string, unknown> {
    const exported: Array<Record<string, unknown>> = []
    const next: SpanProcessor = {
      onStart: () => {},
      onEnd: (span) => {
        exported.push({ ...span.attributes })
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    }
    new ScrubbingSpanProcessor(next).onEnd({ attributes } as unknown as ReadableSpan)
    const [first] = exported
    if (!first) throw new Error('span was not passed on')
    return first
  }

  it('drops request and response bodies and keeps their sizes', () => {
    const result = scrub({
      'http.route': '/calendar',
      'http.request.body': '{"query":"x"}',
      'http.request.body.size': 14,
      'http.response.body': '{"events":[]}',
      'http.response.body.size': 12,
    })
    expect(result).toEqual({
      'http.route': '/calendar',
      'http.request.body.size': 14,
      'http.response.body.size': 12,
    })
  })

  it('still redacts credential headers on a span that carries a body', () => {
    const result = scrub({
      'http.request.header.authorization': 'Bearer test-token',
      'http.response.body': '{"ok":true}',
    })
    expect(result).toEqual({ 'http.request.header.authorization': '[redacted]' })
  })

  it('passes a span without body attributes through unchanged', () => {
    const attributes = { 'http.route': '/health', 'http.response.status_code': 200 }
    expect(scrub(attributes)).toEqual(attributes)
  })
})
