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
  titleQuestion,
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
  it('keeps a short question and leads the evidence with what follows it', () => {
    expect(
      cardCopy({ question: 'Ship {thing}?', body: 'It touches the loop.', title: '{title}' }),
    ).toEqual({
      question: 'Ship {thing}?',
      entity: '{title}',
      evidenceLine: 'It touches the loop.',
      detail: null,
      fromTitle: false,
    })
  })

  it('has no evidence line without a body', () => {
    expect(cardCopy({ question: 'Ship?', body: null })).toMatchObject({
      evidenceLine: null,
      detail: null,
    })
  })

  it('turns a long first sentence into a title question and keeps the whole ask behind it', () => {
    const long = `Should we ${'word '.repeat(QUESTION_MAX)}now?`
    const copy = cardCopy({ question: long, body: 'More follows.', title: '{title}.' })
    expect(copy.question).toBe('Approve {title}?')
    expect(copy.fromTitle).toBe(true)
    expect(copy.evidenceLine?.endsWith('…')).toBe(true)
    expect(copy.detail).toBe(`${long} More follows.`)
  })

  it('has no detail when the evidence line already holds the whole ask', () => {
    const long = `Should we ${'y'.repeat(QUESTION_MAX - 20)} and also ${'z'.repeat(30)}?`
    const copy = cardCopy({ question: long, body: null, title: '{title}' })
    expect(long.length).toBeGreaterThan(QUESTION_MAX)
    expect(long.length).toBeLessThanOrEqual(EVIDENCE_LINE_MAX)
    expect(copy).toMatchObject({ question: 'Approve {title}?', evidenceLine: long, detail: null })
  })

  it('shortens a long question with no title to its lead and keeps the whole ask', () => {
    const long = `Should we ${'word '.repeat(QUESTION_MAX)}now?`
    const copy = cardCopy({ question: long, body: null, title: ' ' })
    expect(copy.question.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(copy.question.endsWith('…')).toBe(true)
    expect(copy.detail).toBe(long.replace(/\s+/g, ' '))
  })

  it('still yields a heading for a blank question', () => {
    expect(cardCopy({ question: '  ', body: 'Why.', title: '{t}', verb: 'Answer' }).question).toBe(
      'Answer {t}?',
    )
    expect(cardCopy({ question: '', body: null }).question).not.toBe('')
  })

  it('takes the verb as a parameter', () => {
    const long = `Should we ${'word '.repeat(QUESTION_MAX)}now?`
    expect(cardCopy({ question: long, body: null, title: '{t}', verb: 'Unblock' }).question).toBe(
      'Unblock {t}?',
    )
  })

  it('normalises whitespace before measuring', () => {
    const q = `Ship   ${' '.repeat(100)}it?`
    expect(cardCopy({ question: q, body: null, title: '{t}' }).question).toBe('Ship it?')
  })

  it('shows the title as the entity unless the question is the title or names it by construction', () => {
    expect(cardCopy({ question: 'Proceed?', body: null, title: '{t}' }).entity).toBe('{t}')
    expect(cardCopy({ question: '{t}?', body: null, title: '{t}' }).entity).toBeNull()
    expect(
      cardCopy({ question: 'Retry {t}?', body: null, title: '{t}', named: true }).entity,
    ).toBeNull()
    expect(cardCopy({ question: 'Should we fix it?', body: null, title: 'Fix' }).entity).toBe('Fix')
  })
})

describe('question form', () => {
  const long = `Should we ${'word '.repeat(QUESTION_MAX)}now?`

  it('keeps a title that is already a question', () => {
    expect(cardCopy({ question: long, body: null, title: 'Ship v2 now?' }).question).toBe(
      'Ship v2 now?',
    )
  })

  it('never builds `Approve Should we …?`', () => {
    const q = cardCopy({ question: long, body: null, title: 'Should we ship v2?' }).question
    expect(q).toBe('Should we ship v2?')
  })

  it('bounds a long title to the question limit, ellipsizing only the title', () => {
    const q = cardCopy({ question: long, body: null, title: 'word '.repeat(60) }).question
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.startsWith('Approve word')).toBe(true)
    expect(q.endsWith('…?')).toBe(true)
  })

  it('bounds a long question-shaped title too', () => {
    const q = cardCopy({ question: long, body: null, title: `${'word '.repeat(60)}ok?` }).question
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.endsWith('?')).toBe(true)
  })

  it('titleQuestion bounds the verb form for a long identifier', () => {
    const q = titleQuestion('Retry', 'x'.repeat(200))
    expect(q.length).toBeLessThanOrEqual(QUESTION_MAX)
    expect(q.startsWith('Retry x')).toBe(true)
  })
})
