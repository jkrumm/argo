import { describe, expect, test } from 'bun:test'
import {
  ATHENA_PAYER,
  EXPLORE_PAYERS,
  exploreScope,
  exploreVolumePayers,
  exploreWord,
  explorePayers,
  insightsPeriodOf,
} from './explore-model'

describe('explorePayers', () => {
  test('an empty selection is every payer but the Athena team key', () => {
    const payers = explorePayers([])
    expect(payers).toEqual([...EXPLORE_PAYERS])
    expect(payers).not.toContain(ATHENA_PAYER)
    expect(payers).toContain('unknown')
    expect(payers).toContain('iu-credit')
  })

  test('a selection is kept in registry order, deduplicated', () => {
    expect(explorePayers(['iu-api', 'me-sub', 'iu-api', 'iu-sub'])).toEqual([
      'iu-sub',
      'me-sub',
      'iu-api',
    ])
  })

  test('the team key appears only when selected', () => {
    expect(explorePayers(['iu-team-api'])).toEqual(['iu-team-api'])
  })

  test('does not mutate the default list', () => {
    explorePayers([]).pop()
    expect(EXPLORE_PAYERS).toContain('unknown')
  })
})

describe('exploreWord', () => {
  test('subscriptions only are list value', () => {
    expect(exploreWord(['iu-sub', 'me-sub'])).toBe('list value')
  })
  test('credit pools and APIs only are spend', () => {
    expect(exploreWord(['iu-credit', 'iu-api'])).toBe('spend')
  })
  test('a mix is dollars at API prices', () => {
    expect(exploreWord(['iu-sub', 'iu-api'])).toBe('$ at API prices')
    expect(exploreWord(EXPLORE_PAYERS)).toBe('$ at API prices')
  })
})

describe('exploreScope', () => {
  test('all payers: neutral ink, the default filter', () => {
    const scope = exploreScope([])
    expect(scope.title).toBe('All payers')
    expect(scope.payers).toEqual([...EXPLORE_PAYERS])
    expect(scope.polarity).toBe('neutral')
  })

  test('one payer is named and takes its own ink', () => {
    const scope = exploreScope(['iu-api'])
    expect(scope.title).toBe('IU API')
    expect(scope.word).toBe('spend')
    expect(scope.polarity).toBe('up-bad')
    expect(scope.color).not.toBe(exploreScope([]).color)
  })

  test('several payers are counted', () => {
    expect(exploreScope(['iu-sub', 'me-sub']).title).toBe('2 payers')
  })
})

describe('exploreVolumePayers', () => {
  test('pairs each payer with its label', () => {
    expect(exploreVolumePayers(['iu-sub', 'me-credit'])).toEqual([
      { id: 'iu-sub', title: 'IU Ultra' },
      { id: 'me-credit', title: 'Me credit' },
    ])
  })
})

describe('insightsPeriodOf', () => {
  test('follows 7, 30 and 90 days and titles the window used', () => {
    expect(insightsPeriodOf('7d')).toEqual({ period: '7d', title: '7 d' })
    expect(insightsPeriodOf('30d')).toEqual({ period: '30d', title: '30 d' })
    expect(insightsPeriodOf('90d')).toEqual({ period: '90d', title: '90 d' })
  })

  test('all has no prior window and reads 90 days, said in the title', () => {
    expect(insightsPeriodOf('all')).toEqual({ period: '90d', title: '90 d' })
  })
})
