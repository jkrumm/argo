import { describe, expect, it } from 'bun:test'
import { consoleUrl } from './console-url'

const at = (protocol: string, hostname: string, port = '') => ({
  protocol,
  hostname,
  origin: `${protocol}//${hostname}${port === '' ? '' : `:${port}`}`,
})

describe('consoleUrl', () => {
  it('swaps the first label of the dev host', () => {
    expect(consoleUrl(at('https:', 'argo.test'))).toBe('https://factory.test/')
  })
  it('swaps the first label of a production host and keeps the path', () => {
    expect(consoleUrl(at('https:', 'argo.example.com'), '/needs-you')).toBe(
      'https://factory.example.com/needs-you',
    )
  })
  it('keeps the protocol', () => {
    expect(consoleUrl(at('http:', 'argo.test'), '/needs-you')).toBe('http://factory.test/needs-you')
  })
  it('is null for a host that does not start with argo.', () => {
    expect(consoleUrl(at('http:', 'localhost', '7715'), '/needs-you')).toBeNull()
    expect(consoleUrl(at('https:', 'my-argo.example.com'))).toBeNull()
  })
})
