import { describe, expect, it } from 'bun:test'
import { isSafeHttpUrl } from './safe-url'

describe('isSafeHttpUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(isSafeHttpUrl('https://github.com/jkrumm/argo/issues/1')).toBe(true)
    expect(isSafeHttpUrl('http://example.com')).toBe(true)
  })

  it('rejects non-http(s) schemes and unparsable strings', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('not a url')).toBe(false)
  })
})
