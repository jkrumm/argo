import { describe, expect, test } from 'bun:test'
import { IDENTIFIER_MAX, identifierRuns } from './identifier-runs'

describe('identifierRuns', () => {
  test('flags identifiers and keeps plain words in breakable runs', () => {
    expect(identifierRuns('Merge repo/feat-x now')).toEqual([
      { text: 'Merge ', identifier: false },
      { text: 'repo/feat-x', identifier: true },
      { text: ' now', identifier: false },
    ])
  })
  test('does not flag edge punctuation', () => {
    for (const text of ['Retry item? - ok', 'path/', '-x /y'])
      expect(identifierRuns(text).every((run) => !run.identifier)).toBe(true)
  })
  test('does not flag a token longer than the cap', () => {
    const long = `a-${'b'.repeat(IDENTIFIER_MAX)}`
    expect(identifierRuns(long)).toEqual([{ text: long, identifier: false }])
  })
  test('joined run text equals the input', () => {
    const raw = 'Merge repo/feat--x,  a//b and -c now\n'
    expect(
      identifierRuns(raw)
        .map((run) => run.text)
        .join(''),
    ).toBe(raw)
  })
})
