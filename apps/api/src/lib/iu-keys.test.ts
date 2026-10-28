import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_IU_KEY,
  IU_KEYS,
  IU_KEY_LABELS,
  IU_KEY_LIMIT_USD,
  IU_KEY_PATTERN,
  IuKeyEnum,
  parseIuKey,
} from './iu-keys.js'

describe('iu-keys registry', () => {
  it('registers personal and athena-team, personal as the default', () => {
    expect([...IU_KEYS]).toEqual(['personal', 'athena-team'])
    expect(DEFAULT_IU_KEY).toBe('personal')
  })

  it('has a label and a cap for every key, and every id fits the pattern', () => {
    for (const id of IU_KEYS) {
      expect(IU_KEY_LABELS[id].length).toBeGreaterThan(0)
      expect(IU_KEY_LIMIT_USD[id]).toBe(500)
      expect(IU_KEY_PATTERN.test(id)).toBe(true)
    }
  })

  it('pattern rejects ids that are not lowercase slugs', () => {
    expect(IU_KEY_PATTERN.test('Personal')).toBe(false)
    expect(IU_KEY_PATTERN.test('1key')).toBe(false)
    expect(IU_KEY_PATTERN.test('')).toBe(false)
    expect(IU_KEY_PATTERN.test('a'.repeat(33))).toBe(false)
    expect(IU_KEY_PATTERN.test('a'.repeat(32))).toBe(true)
  })

  it('parseIuKey returns registered ids only', () => {
    expect(parseIuKey('personal')).toBe('personal')
    expect(parseIuKey(' athena-team ')).toBe('athena-team')
    expect(parseIuKey('future-key')).toBeNull()
    expect(parseIuKey('')).toBeNull()
    expect(parseIuKey(null)).toBeNull()
    expect(parseIuKey(undefined)).toBeNull()
    expect(parseIuKey(3)).toBeNull()
  })

  it('IuKeyEnum accepts exactly the registered ids', () => {
    expect(IuKeyEnum.safeParse('athena-team').success).toBe(true)
    expect(IuKeyEnum.safeParse('all').success).toBe(false)
  })
})
