import { describe, expect, it } from 'bun:test'
import { settledRunIds } from './run-liveness'

describe('settledRunIds', () => {
  it('reports every thread that left the live set, per thread, not on the aggregate edge', () => {
    // a stays live while b settles and c starts: b must still be reported.
    expect(settledRunIds(new Set(['a', 'b']), new Set(['a', 'c']))).toEqual(['b'])
  })

  it('reports nothing while the same runs stay live', () => {
    expect(settledRunIds(new Set(['a']), new Set(['a']))).toEqual([])
  })

  it('reports all threads when the live set empties', () => {
    expect(settledRunIds(new Set(['a', 'b']), new Set())).toEqual(['a', 'b'])
  })
})
