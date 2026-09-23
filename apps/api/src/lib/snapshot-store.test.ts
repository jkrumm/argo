import { describe, it, expect } from 'bun:test'
import { stripNulBytes } from './snapshot-store.js'

describe('stripNulBytes', () => {
  it('strips \\u0000 from a plain string value', () => {
    expect(stripNulBytes('foo\u0000bar')).toBe('foobar')
  })

  it('strips \\u0000 from nested object values and keys', () => {
    const input: Record<string, unknown> = {
      'key\u0000with\u0000nul': 'value\u0000here',
      nested: { deeper: 'a\u0000b\u0000c' },
    }
    expect(stripNulBytes(input)).toEqual({
      keywithnul: 'valuehere',
      nested: { deeper: 'abc' },
    })
  })

  it('strips \\u0000 from strings inside arrays, including nested objects', () => {
    const input = ['clean', 'dirty\u0000value', { name: 'x\u0000y' }]
    expect(stripNulBytes(input)).toEqual(['clean', 'dirtyvalue', { name: 'xy' }])
  })

  it('leaves non-string leaves untouched', () => {
    const input = { count: 42, active: true, missing: null, ratio: 3.14 }
    expect(stripNulBytes(input)).toEqual(input)
  })

  it('is a no-op for values with no NUL bytes', () => {
    const input = { a: 'b', list: [1, 2, 'three'] }
    expect(stripNulBytes(input)).toEqual(input)
  })
})
