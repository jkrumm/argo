import { describe, expect, it } from 'bun:test'
import { capFacts, hasActions, isInactive, isRenderable, visibleFacts } from './decision-card-model'

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
