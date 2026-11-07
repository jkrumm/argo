import { describe, expect, it } from 'bun:test'
import { NBSP } from './format'
import { glueNumberUnits, titleSegments } from './text-breaks'

describe('glueNumberUnits', () => {
  it('glues a number to the unit after it', () => {
    expect(glueNumberUnits('keep the 50 GB floor?')).toBe(`keep the 50${NBSP}GB floor?`)
    expect(glueNumberUnits('at 90 % for 3 d, 2 h, 15 min, 4 s, 200 ms')).toBe(
      `at 90${NBSP}% for 3${NBSP}d, 2${NBSP}h, 15${NBSP}min, 4${NBSP}s, 200${NBSP}ms`,
    )
  })

  it('leaves words that merely start with a unit letter, and unit-less numbers, alone', () => {
    const text = 'retry 3 days later, 2 hours, 90 %ile, 5 sutob rounds, 7 dogs'
    expect(glueNumberUnits(text)).toBe(text)
  })
})

describe('titleSegments', () => {
  const texts = (input: string) => titleSegments(input).map((s) => s.text)
  const rejoined = (input: string) => texts(input).join('')

  it('cuts a long token after . / _ - and ::, marking each cut as a break', () => {
    const input = 'test_checkout_flow.spec/handles::retry'
    expect(texts(input)).toEqual(['test_', 'checkout_', 'flow.', 'spec/', 'handles::', 'retry'])
    expect(titleSegments(input).map((s) => s.breakBefore)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
    ])
    expect(rejoined(input)).toBe(input)
  })
  it('leaves a 13-character token whole and cuts a 14-character one', () => {
    expect(texts('abcdef_ghijkl')).toEqual(['abcdef_ghijkl']) // 13
    expect(texts('abcdef_ghijklm')).toEqual(['abcdef_', 'ghijklm']) // 14
  })
  it('breaks after `::` but not after a single `:`', () => {
    expect(texts('suite_name::case_name')).toEqual(['suite_', 'name::', 'case_', 'name'])
    expect(texts('suite_name:case_name')).toEqual(['suite_', 'name:case_', 'name'])
  })
  it('cuts after the last of repeated separators, never between them (foo--bar)', () => {
    expect(texts('long_prefix_foo--bar')).toEqual(['long_', 'prefix_', 'foo--', 'bar'])
  })
  it('keeps a leading ./ whole: no cut between its `.` and `/`', () => {
    expect(texts('./src/some/long/path.ts')).toEqual([
      './',
      'src/',
      'some/',
      'long/',
      'path.',
      'ts',
    ])
  })
  it('never breaks across whitespace and leaves ordinary text whole', () => {
    const input = 'Fix a well-known flaky bug in v1.2'
    expect(titleSegments(input).every((s) => !s.breakBefore)).toBe(true)
    expect(rejoined(input)).toBe(input)
  })
  it('returns nothing for an empty string', () => {
    expect(titleSegments('')).toEqual([])
  })
})
