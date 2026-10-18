import { describe, expect, it } from 'bun:test'
import { failed, feedGap, taskFeedState, unanswered } from './query-state'

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

describe('failed', () => {
  it('is a source that stopped trying, not one still retrying or answered', () => {
    expect(failed(q({ isError: true, data: undefined }))).toBe(true)
    expect(failed(q({ isError: true, data: undefined, isFetching: true }))).toBe(false)
    expect(failed(q({ isError: true, data: [] }))).toBe(false)
    expect(failed(q({ isPending: true, data: undefined }))).toBe(false)
  })
})

describe('feedGap', () => {
  const none = new Set<'personal' | 'work'>()
  it('is null when every source answered', () => {
    expect(feedGap(none, none)).toBeNull()
  })
  it('says loading until a source has failed', () => {
    expect(feedGap(new Set(['work']), none)).toMatchObject({
      state: 'loading',
      text: 'Loading calendar',
      card: 'Loading',
    })
  })
  it('names the failed sources and the next step', () => {
    expect(feedGap(new Set(['personal', 'work']), new Set(['work', 'personal']))).toMatchObject({
      state: 'error',
      text: 'Google and Microsoft 365 failed to load',
      card: 'Google and Microsoft 365 failed to load',
    })
    expect(feedGap(new Set(['work']), new Set(['work']))?.text).toBe('Microsoft 365 failed to load')
  })
})

describe('feedGap mixed state', () => {
  it('names a failed and a loading source together', () => {
    const gap = feedGap(new Set(['personal', 'work']), new Set(['work']))
    expect(gap).toMatchObject({
      state: 'error',
      card: 'Microsoft 365 failed to load · Google loading',
      text: 'Microsoft 365 failed to load · Google loading',
    })
  })
})

describe('taskFeedState', () => {
  const read = (over: Partial<Parameters<typeof taskFeedState>[0][number]> = {}) => ({
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    isFetching: false,
    data: {} as unknown,
    ...over,
  })
  it('is loading while any read is pending, even beside a failed one', () => {
    expect(taskFeedState([read({ isPending: true, data: undefined })])).toBe('loading')
    expect(
      taskFeedState([
        read({ isPending: true, data: undefined }),
        read({ isError: true, data: undefined }),
      ]),
    ).toBe('loading')
  })
  it('is loading while a read is still fetching behind placeholder data', () => {
    expect(taskFeedState([read({ isPlaceholderData: true, isFetching: true })])).toBe('loading')
    expect(taskFeedState([read({ isPlaceholderData: true })])).toBe('ready')
  })
  it('is error only once every read has settled and one has nothing to show', () => {
    expect(taskFeedState([read(), read({ isError: true, data: undefined })])).toBe('error')
  })
  it('does not count a failed background refetch that still holds cached data', () => {
    expect(taskFeedState([read({ isError: true })])).toBe('ready')
  })
  it('is ready with no reads or only settled ones', () => {
    expect(taskFeedState([])).toBe('ready')
    expect(taskFeedState([read()])).toBe('ready')
  })
})
