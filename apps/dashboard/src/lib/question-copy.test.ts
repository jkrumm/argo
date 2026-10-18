import { describe, expect, it } from 'bun:test'
import {
  ENTITY_MAX,
  EVIDENCE_LINE_MAX,
  QUESTION_MAX,
  cardCopy,
  leadOf,
  plainQuestion,
  wardenPlainQuestion,
} from './question-copy'

describe('leadOf', () => {
  it('returns text that fits whole', () => {
    expect(leadOf('  short   text ', 40)).toBe('short text')
  })
  it('cuts at a word boundary with an ellipsis', () => {
    const lead = leadOf('alpha beta gamma delta epsilon', 18)
    expect(lead).toBe('alpha beta gamma…')
  })
})

describe('cardCopy', () => {
  const longQuestion = `Should we ${'word '.repeat(QUESTION_MAX)}now?`

  it('uses the authored question verbatim, flattened', () => {
    const copy = cardCopy({
      authored: '  Merge   the {repo} fix? ',
      ask: 'Something else?',
      body: 'It touches the loop.',
      title: 'fix(loop): raw subject',
      plain: 'Merge {repo} PR?',
    })
    expect(copy).toMatchObject({
      question: 'Merge the {repo} fix?',
      source: 'authored',
      entity: 'fix(loop): raw subject',
    })
  })

  it('never cuts a long authored question into a fragment: it falls through, whole in the detail', () => {
    const copy = cardCopy({ authored: longQuestion, title: '{t}', plain: 'Merge {r} PR?' })
    expect(copy.source).toBe('plain')
    expect(copy.question).toBe('Merge {r} PR?')
    expect(copy.detail).toContain(longQuestion.replace(/\s+/g, ' '))
  })

  it('lets a long authored question fall to a fitting ask question', () => {
    expect(cardCopy({ authored: longQuestion, ask: 'Ship it?' }).question).toBe('Ship it?')
  })

  it('ignores a blank authored question', () => {
    expect(cardCopy({ authored: '   ', ask: 'Ship {thing}?', title: '{t}' }).source).toBe('ask')
  })

  it('takes the ask when it is a question that fits, evidence from the body', () => {
    expect(
      cardCopy({ ask: 'Ship {thing}?', body: 'It touches the loop.', title: '{title}' }),
    ).toEqual({
      question: 'Ship {thing}?',
      entity: '{title}',
      evidenceLine: 'It touches the loop.',
      detail: null,
      source: 'ask',
    })
  })

  it('does not take an ask that is a statement; it becomes the evidence', () => {
    const copy = cardCopy({
      ask: 'Deploy needs approval.',
      title: 'fix(loop): raw subject',
      plain: 'Merge {repo} PR?',
    })
    expect(copy).toMatchObject({
      question: 'Merge {repo} PR?',
      source: 'plain',
      evidenceLine: 'Deploy needs approval.',
      entity: 'fix(loop): raw subject',
    })
  })

  it('does not take an ask question past the limit', () => {
    const copy = cardCopy({ ask: longQuestion, title: '{t}', plain: 'Decide on {r} item?' })
    expect(copy.source).toBe('plain')
    expect(copy.evidenceLine).toBeNull()
    expect(copy.detail).toBe(longQuestion.replace(/\s+/g, ' '))
  })

  it('takes the title when it already is a question', () => {
    const copy = cardCopy({ ask: 'Fine.', title: 'Ship v2 now?', plain: 'Merge {r} PR?' })
    expect(copy).toMatchObject({ question: 'Ship v2 now?', source: 'title', entity: null })
  })

  it('never glues a verb onto a raw title', () => {
    for (const title of [
      'fix(dashboard): review round 1',
      'disk_usage_high',
      'Add retry to loop',
    ]) {
      const copy = cardCopy({ title, plain: 'Retry failed {r} run?' })
      expect(copy.question).toBe('Retry failed {r} run?')
      expect(copy.entity).toBe(title)
    }
  })

  it('keeps the raw title whole on the entity line', () => {
    const title = 'x'.repeat(ENTITY_MAX)
    expect(cardCopy({ title }).entity).toBe(title)
  })

  it('moves a title past the entity limit, whole, into the detail', () => {
    const title = `${'word '.repeat(ENTITY_MAX)}end`
    const copy = cardCopy({ title, body: 'Why.' })
    expect(copy.entity).toBeNull()
    expect(copy.detail).toBe(`${title.replace(/\s+/g, ' ')} Why.`)
  })

  it('has a question and no evidence for an empty item', () => {
    expect(cardCopy({})).toMatchObject({
      question: 'Decide on this item?',
      evidenceLine: null,
      detail: null,
      entity: null,
    })
  })

  it('shows the title as the entity unless the question already is it', () => {
    expect(cardCopy({ ask: 'Proceed?', title: '{t}' }).entity).toBe('{t}')
    expect(cardCopy({ ask: '{t}?', title: '{t}' }).entity).toBeNull()
  })
})

describe('evidence line', () => {
  it('is one line: statements only, never a second question', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Tests pass. Should we wait? CI is green.' })
    expect(copy.evidenceLine).toBe('Tests pass. CI is green.')
    expect(copy.detail).toBe('Tests pass. Should we wait? CI is green.')
  })

  it('is empty when the reason is only questions, with the whole text behind the detail', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Is it safe? Who knows?' })
    expect(copy.evidenceLine).toBeNull()
    expect(copy.detail).toBe('Is it safe? Who knows?')
  })

  it('never ends in a raw URL, and keeps the URL in the detail', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed, see https://example.com/runs/42',
    })
    expect(copy.evidenceLine).toBe('Checks failed,')
    expect(copy.detail).toBe('Checks failed, see https://example.com/runs/42')
  })

  it('cuts at a word boundary within the line limit', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'word '.repeat(EVIDENCE_LINE_MAX) })
    expect(copy.evidenceLine?.length).toBeLessThanOrEqual(EVIDENCE_LINE_MAX)
    expect(copy.evidenceLine?.endsWith('…')).toBe(true)
    expect(copy.detail).not.toBeNull()
  })

  it('has no detail when the line holds the whole text', () => {
    expect(cardCopy({ authored: 'Merge?', body: 'Short.' })).toMatchObject({
      evidenceLine: 'Short.',
      detail: null,
    })
  })
})

describe('plainQuestion', () => {
  it('is `<verb> <object>?`', () => {
    expect(plainQuestion('Merge', '{repo}  PR')).toBe('Merge {repo} PR?')
  })
  it('is bounded and keeps its question mark', () => {
    const q = plainQuestion('Retry', 'x'.repeat(200))
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.endsWith('?')).toBe(true)
  })
  it('is never empty', () => {
    expect(plainQuestion('', '')).toBe('Decide on this item?')
    expect(cardCopy({ plain: '  ' }).question).toBe('Decide on this item?')
  })
  it('bounds a caller-built plain question too', () => {
    const q = cardCopy({ plain: `Merge ${'x'.repeat(200)}?` }).question
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.endsWith('?')).toBe(true)
  })
})

describe('wardenPlainQuestion', () => {
  const ask = (
    primary: Parameters<typeof wardenPlainQuestion>[0]['primary'],
    failed = false,
    repo: string | null = '{r}',
  ) => wardenPlainQuestion({ failed, repo, primary })
  it('names the verb the card offers first', () => {
    expect(ask('merge')).toBe('Merge {r} PR?')
    expect(ask('implement')).toBe('Implement {r} change?')
    expect(ask('reinvestigate')).toBe('Reinvestigate {r} item?')
    expect(ask('merge', false, null)).toBe('Merge this PR?')
  })
  it('says Retry failed run only for a failed item whose primary is retry', () => {
    expect(ask('retry', true)).toBe('Retry failed {r} run?')
    expect(ask('retry', true, null)).toBe('Retry failed run?')
    expect(ask('retry', false)).toBe('Retry {r} item?')
  })
  it('is neutral when the primary is not a verb that names a question', () => {
    expect(ask('dismiss', true)).toBe('Decide on {r} item?')
    expect(ask('merge', true)).toBe('Merge {r} PR?')
    expect(ask(null, true, null)).toBe('Decide on this item?')
  })
})

describe('evidence urls', () => {
  it('removes a bracketed URL whole, leaving no dangling bracket', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed (see https://example.com/runs/42).',
    })
    expect(copy.evidenceLine).toBe('Checks failed.')
  })
  it('closes a bracket the URL removal left open', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Checks failed (at https://example.com/x' })
    expect(copy.evidenceLine).toBe('Checks failed ()')
  })
})

describe('round 2 rules', () => {
  it('closes a square bracket the URL removal left open', () => {
    const copy = cardCopy({ authored: 'Merge?', body: 'Checks failed [at https://example.com/x' })
    expect(copy.evidenceLine).toBe('Checks failed []')
  })
  it('removes a square-bracketed URL whole', () => {
    const copy = cardCopy({
      authored: 'Merge?',
      body: 'Checks failed [see https://example.com/x].',
    })
    expect(copy.evidenceLine).toBe('Checks failed.')
  })
  it('always ends a plain question in `?`', () => {
    expect(cardCopy({ plain: 'Merge the PR' }).question).toBe('Merge the PR?')
    expect(cardCopy({ plain: 'Merge the PR???' }).question).toBe('Merge the PR?')
  })
  it('keeps question-only evidence when asked to', () => {
    const body = 'Which branch should I use?'
    expect(cardCopy({ authored: 'Pick?', body }).evidenceLine).toBeNull()
    expect(cardCopy({ authored: 'Pick?', body, keepQuestionEvidence: true }).evidenceLine).toBe(
      body,
    )
  })
})
