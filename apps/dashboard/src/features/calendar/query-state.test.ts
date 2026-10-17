import { describe, expect, it } from 'bun:test'
import { unanswered } from './query-state'

const q = (over: Partial<Parameters<typeof unanswered>[0]> = {}) => ({
  isPending: false,
  isError: false,
  isPlaceholderData: false,
  isFetching: false,
  data: [] as unknown,
  ...over,
})

describe('unanswered', () => {
  it('reads a pending, placeholder-loading or failed-with-nothing source as unknown', () => {
    expect(unanswered(q({ isPending: true, data: undefined }))).toBe(true)
    expect(unanswered(q({ isPlaceholderData: true, isFetching: true }))).toBe(true)
    expect(unanswered(q({ isError: true, data: undefined }))).toBe(true)
  })

  it('reads an answered source, even an empty or refetching one, as known', () => {
    expect(unanswered(q())).toBe(false)
    expect(unanswered(q({ isFetching: true }))).toBe(false)
    expect(unanswered(q({ isError: true, data: [] }))).toBe(false)
  })
})
