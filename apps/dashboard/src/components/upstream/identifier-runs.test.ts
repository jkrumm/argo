import { describe, expect, test } from 'bun:test'
import { IDENTIFIER_MAX, TOKEN_BOUNDARY, identifierRuns } from './identifier-runs'

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
  test('flags identifiers joined by . _ and ::', () => {
    for (const token of ['a.b', 'pr_title', 'Foo::bar', 'v1.2.3'])
      expect(identifierRuns(`x ${token} y`)[1]).toEqual({ text: token, identifier: true })
  })
  test('a token longer than the cap breaks only at its joints', () => {
    const long = `warden_loop/${'b'.repeat(IDENTIFIER_MAX)}.tail`
    const [run] = identifierRuns(long)
    expect(run?.identifier).toBe(false)
    expect(run?.parts).toEqual(['warden_', 'loop/', `${'b'.repeat(IDENTIFIER_MAX)}.`, 'tail'])
    expect(run?.parts?.join('')).toBe(long)
  })
  test('a long run between plain words stays separate from them', () => {
    const long = `a-${'b'.repeat(IDENTIFIER_MAX)}`
    const runs = identifierRuns(`see ${long} now`)
    expect(runs.map((r) => r.text)).toEqual(['see ', long, ' now'])
    expect(runs[1]?.parts).toEqual(['a-', 'b'.repeat(IDENTIFIER_MAX)])
  })
  test('a long token with no joint stays plain text', () => {
    const long = 'x'.repeat(IDENTIFIER_MAX + 5)
    expect(identifierRuns(long)).toEqual([{ text: long, identifier: false }])
  })
  test('TOKEN_BOUNDARY splits after joints, not before them', () => {
    expect('a::b.c_d-e/f'.split(TOKEN_BOUNDARY)).toEqual(['a::', 'b.', 'c_', 'd-', 'e/', 'f'])
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
