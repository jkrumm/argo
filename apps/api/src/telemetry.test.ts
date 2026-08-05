import { describe, it, expect } from 'bun:test'
import { redactHeaderAttributes, REDACTED_HEADER_NAMES } from './telemetry.js'

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
