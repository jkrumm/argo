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
    expect(copy.question).toBe('Decide on {title}?')
    expect(copy.fromTitle).toBe(true)
    expect(copy.evidenceLine?.endsWith('…')).toBe(true)
    expect(copy.detail).toBe(`${long} More follows.`)
  })

  it('has no detail when the evidence line already holds the whole ask', () => {
    const long = `Should we ${'y'.repeat(QUESTION_MAX - 20)} and also ${'z'.repeat(30)}?`
    const copy = cardCopy({ question: long, body: null, title: '{title}' })
    expect(long.length).toBeGreaterThan(QUESTION_MAX)
    expect(long.length).toBeLessThanOrEqual(EVIDENCE_LINE_MAX)
    expect(copy).toMatchObject({ question: 'Decide on {title}?', evidenceLine: long, detail: null })
  })

  it('leaves a long question alone when there is no title to stand in', () => {
    const long = `Should we ${'x'.repeat(QUESTION_MAX)} now?`
    expect(cardCopy({ question: long, body: null, title: ' ' }).question).toBe(long)
  })
})
