import { describe, expect, it } from 'bun:test'
import {
  EVIDENCE_LINE_MAX,
  QUESTION_MAX,
  capFacts,
  cardCopy,
  hasActions,
  isInactive,
  isRenderable,
  leadOf,
  plainQuestion,
  ENTITY_MAX,
  visibleFacts,
} from './decision-card-model'

const action = { label: 'Go', onClick: () => {} }

describe('visibleFacts', () => {
  it('trims facts and drops blanks', () => {
    expect(visibleFacts(['repo-a', ' ', 'waiting 3 d', '']).map((f) => f.text)).toEqual([
      'repo-a',
      'waiting 3 d',
    ])
  })

  it('carries the tone of a toned fact', () => {
    expect(visibleFacts(['a', { text: 'waiting 3 d', tone: 'warn' }])).toEqual([
      { text: 'a', tone: undefined },
      { text: 'waiting 3 d', tone: 'warn' },
    ])
  })

  it('is empty for no facts', () => {
    expect(visibleFacts([])).toEqual([])
  })
})

describe('hasActions', () => {
  it('is false for a read-only card', () => {
    expect(hasActions(undefined, undefined, undefined)).toBe(false)
    expect(hasActions(undefined, undefined, [])).toBe(false)
  })

  it('is true when any of primary, secondary or menu is set', () => {
    expect(hasActions(action, undefined, undefined)).toBe(true)
    expect(hasActions(undefined, action, undefined)).toBe(true)
    expect(hasActions(undefined, undefined, [action])).toBe(true)
  })
})

describe('isInactive', () => {
  it('is false for a plain action', () => {
    expect(isInactive(action)).toBe(false)
  })

  it('is true when disabled or loading', () => {
    expect(isInactive({ ...action, disabled: true })).toBe(true)
    expect(isInactive({ ...action, loading: true })).toBe(true)
    expect(isInactive({ ...action, disabled: false, loading: false })).toBe(false)
  })
})

describe('isRenderable', () => {
  it('is false for nothing-nodes', () => {
    for (const node of [undefined, null, false, true, '']) expect(isRenderable(node)).toBe(false)
  })

  it('is true for text, numbers and elements', () => {
    for (const node of ['a', 0, { type: 'span' } as never]) expect(isRenderable(node)).toBe(true)
  })
})

describe('capFacts', () => {
  it('keeps the first three non-blank facts and their tone', () => {
    expect(capFacts(['a', ' ', { text: 'waiting 3 d', tone: 'warn' }, 'b', 'c'])).toEqual([
      'a',
      { text: 'waiting 3 d', tone: 'warn' },
      'b',
    ])
  })
})

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

  it('caps a long authored question and keeps the cut text in the evidence', () => {
    const copy = cardCopy({ authored: longQuestion, title: '{t}' })
    expect(copy.source).toBe('authored')
    expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(copy.question.endsWith('…')).toBe(true)
    expect(copy.detail).toBe(longQuestion.replace(/\s+/g, ' '))
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
})
