import { describe, expect, it } from 'bun:test'
import {
  fmtMinuteTick,
  fmtPoints,
  fmtRatio,
  fmtSeconds,
  fmtTokens,
  fmtUsd,
  logTicks,
  shortLineage,
} from './format'

describe('format', () => {
  it('prints dollars at the precision the figure needs', () => {
    expect([0.0051, 0.0713, 0.1688, 2.4511, 12.994].map(fmtUsd)).toEqual([
      '$0.005',
      '$0.071',
      '$0.17',
      '$2.45',
      '$13',
    ])
  })

  it('marks estimates with ≈', () => {
    expect(fmtTokens(51_900)).toBe('≈52k')
    expect(fmtTokens(1_240_000)).toBe('≈1.2M')
    expect(fmtTokens(51_900, false)).toBe('52k')
    expect(fmtSeconds(660).replace(/\s/g, ' ')).toBe('≈11 min')
    expect(fmtSeconds(40).replace(/\s/g, ' ')).toBe('≈40 s')
    expect(fmtMinuteTick(0.5).replace(/\s/g, ' ')).toBe('0.5 min')
    expect(fmtMinuteTick(240).replace(/\s/g, ' ')).toBe('4 h')
  })

  it('writes the verdict delta', () => {
    expect(fmtPoints(8.3).replace(/\s/g, ' ')).toBe('+8.3 pts')
    expect(fmtRatio(0.5)).toBe('×0.5')
    expect(fmtRatio(0.3733)).toBe('×0.37')
    expect(fmtRatio(1.064)).toBe('×1.1')
  })
})

describe('logTicks', () => {
  it('ticks at 1, 2 and 5 of each decade inside the range', () => {
    expect(logTicks(0.04, 3, 12)).toEqual([0.05, 0.1, 0.2, 0.5, 1, 2])
  })

  it('thins to 1-5 and then to decades for a narrow plot', () => {
    expect(logTicks(0.04, 3, 5)).toEqual([0.05, 0.1, 0.5, 1])
    expect(logTicks(0.004, 30, 4)).toEqual([0.01, 0.1, 1, 10])
  })

  it('is empty for a range a log axis cannot hold', () => {
    expect(logTicks(0, 5, 5)).toEqual([])
    expect(logTicks(5, 5, 5)).toEqual([])
  })
})

describe('shortLineage', () => {
  const all = ['GPT-6.1 Terra', 'GPT-6.1 Sol', 'GPT-6 Sol', 'Claude Haiku 5.5', 'Kimi K3.1 Pro']
  it('drops the vendor prefix when the rest is unique', () => {
    expect(shortLineage('GPT-6.1 Terra', all)).toBe('Terra')
    expect(shortLineage('Claude Haiku 5.5', all)).toBe('Haiku 5.5')
    expect(shortLineage('Kimi K3.1 Pro', all)).toBe('Kimi K3.1 Pro')
  })

  it('keeps the full name when two lineages would read the same', () => {
    expect(shortLineage('GPT-6.1 Sol', all)).toBe('GPT-6.1 Sol')
    expect(shortLineage('GPT-6 Sol', all)).toBe('GPT-6 Sol')
  })
})
