import { describe, expect, it } from 'bun:test'
import { consoleUrl } from './console-url'

describe('consoleUrl', () => {
  it('joins the path onto the configured origin', () => {
    expect(consoleUrl('https://factory.example.com', '/needs-you')).toBe(
      'https://factory.example.com/needs-you',
    )
  })
  it('defaults to the root and ignores a trailing slash or path on the origin', () => {
    expect(consoleUrl('https://factory.example.com/')).toBe('https://factory.example.com/')
    expect(consoleUrl('https://factory.example.com/ignored', '/flow')).toBe(
      'https://factory.example.com/flow',
    )
  })
  it('keeps protocol and port', () => {
    expect(consoleUrl('http://factory.test:7795', '/flow')).toBe('http://factory.test:7795/flow')
  })
  it('is null when unset, empty, malformed or not http(s)', () => {
    expect(consoleUrl(undefined)).toBeNull()
    expect(consoleUrl('')).toBeNull()
    expect(consoleUrl('factory.example.com')).toBeNull()
    expect(consoleUrl('javascript:alert(1)')).toBeNull()
  })
})
