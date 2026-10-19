import { describe, expect, test } from 'bun:test'
import { TOKEN_BOUNDARY } from '../../lib/text-breaks'
import { IDENTIFIER_MAX, identifierRuns } from './identifier-runs'

const kinds = (text: string) => identifierRuns(text).map((run) => run.kind)

describe('identifierRuns', () => {
  test('flags identifiers and keeps plain words in text runs', () => {
    expect(identifierRuns('Merge repo/feat-x now')).toEqual([
      { kind: 'text', text: 'Merge ' },
      { kind: 'identifier', text: 'repo/feat-x' },
      { kind: 'text', text: ' now' },
    ])
  })
  test('does not flag edge punctuation', () => {
    for (const text of ['Retry item? - ok', 'path/', '-x /y', 'done.', 'Is it done. Yes'])
      expect(kinds(text).every((kind) => kind === 'text')).toBe(true)
  })
  test('flags tokens joined by . _ and ::', () => {
    for (const token of ['a.b', 'pr_title', 'Foo::bar', 'v1.2', 'file.ts', 'snake_case'])
      expect(identifierRuns(`x ${token} y`)[1]).toEqual({ kind: 'identifier', text: token })
  })
  test('a token longer than the cap breaks only at its joints', () => {
    const long = `warden_loop/${'b'.repeat(IDENTIFIER_MAX)}.tail`
    expect(identifierRuns(long)).toEqual([
      {
        kind: 'breakable',
        text: long,
        parts: ['warden_', 'loop/', `${'b'.repeat(IDENTIFIER_MAX)}.`, 'tail'],
      },
    ])
  })
  test('a long run between plain words stays separate from them', () => {
    const long = `a-${'b'.repeat(IDENTIFIER_MAX)}`
    expect(identifierRuns(`see ${long} now`)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'breakable', text: long, parts: ['a-', 'b'.repeat(IDENTIFIER_MAX)] },
      { kind: 'text', text: ' now' },
    ])
  })
  test('a long token with no joint stays plain text', () => {
    const long = 'x'.repeat(IDENTIFIER_MAX + 5)
    expect(identifierRuns(long)).toEqual([{ kind: 'text', text: long }])
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

describe('TOKEN_BOUNDARY', () => {
  test('splits after joints, not before them', () => {
    expect('a::b.c_d-e/f'.split(TOKEN_BOUNDARY)).toEqual(['a::', 'b.', 'c_', 'd-', 'e/', 'f'])
  })
})
