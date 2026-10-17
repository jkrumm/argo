import { describe, expect, test } from 'bun:test'
import { sentenceCase } from './status-chip'

describe('sentenceCase', () => {
  test('turns enum casing into a sentence', () => {
    expect(sentenceCase('BLOCKER')).toBe('Blocker')
    expect(sentenceCase('data_loss')).toBe('Data loss')
    expect(sentenceCase(' needs_decision ')).toBe('Needs decision')
  })
})
