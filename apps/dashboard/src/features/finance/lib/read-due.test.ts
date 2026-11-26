import { describe, expect, it } from 'bun:test'
import type { IngReadDue } from '../api/types'
import { readDueText } from './read-due'

const none: IngReadDue = { due: false, since: null, notifications: 0, last_read_at: null }

describe('readDueText', () => {
  it('stays silent while nothing is due or the answer has not arrived', () => {
    expect(readDueText(undefined)).toBeNull()
    expect(readDueText(none)).toBeNull()
  })

  it('names the date of the oldest unread announcement', () => {
    expect(
      readDueText({ due: true, since: '2026-11-20', notifications: 2, last_read_at: '2026-10-01' }),
    ).toBe('ING announced new Post-Box documents since 2026-11-20. A supervised ING read is due.')
  })

  it('still reads when no date came with it', () => {
    expect(readDueText({ due: true, since: null, notifications: 1, last_read_at: null })).toBe(
      'ING announced new Post-Box documents. A supervised ING read is due.',
    )
  })
})
