import { describe, expect, it } from 'bun:test'
import { NBSP } from './format'
import { FACT_SEPARATOR, glueNumberUnits } from './text-breaks'

describe('glueNumberUnits', () => {
  it('glues a number to the unit after it', () => {
    expect(glueNumberUnits('keep the 50 GB floor?')).toBe(`keep the 50${NBSP}GB floor?`)
    expect(glueNumberUnits('at 90 % for 3 d, 2 h, 15 min, 4 s, 200 ms')).toBe(
      `at 90${NBSP}% for 3${NBSP}d, 2${NBSP}h, 15${NBSP}min, 4${NBSP}s, 200${NBSP}ms`,
    )
  })

  it('leaves words that merely start with a unit letter, and unit-less numbers, alone', () => {
    const text = 'retry 3 days later, 2 hours, 5 sutob rounds, 7 dogs'
    expect(glueNumberUnits(text)).toBe(text)
  })
})

describe('FACT_SEPARATOR', () => {
  it('breaks before the dot and never after it', () => {
    expect(FACT_SEPARATOR).toBe(` ·${NBSP}`)
  })
})
