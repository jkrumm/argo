import { describe, expect, it } from 'bun:test'
import { factsLine, hasActions, isInactive } from './decision-card-model'

const action = { label: 'Go', onClick: () => {} }

describe('factsLine', () => {
  it('joins facts with a middle dot and drops blanks', () => {
    expect(factsLine(['repo-a', ' ', 'waiting 3 d', ''])).toBe('repo-a · waiting 3 d')
  })

  it('is empty for no facts', () => {
    expect(factsLine([])).toBe('')
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
