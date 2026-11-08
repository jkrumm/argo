import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { QueryBool } from './query-bool.js'

const Query = z.object({ flag: QueryBool.default(false).optional() })

describe('QueryBool', () => {
  it('parses "false" as false and "true" as true', () => {
    expect(QueryBool.parse('false')).toBe(false)
    expect(QueryBool.parse('true')).toBe(true)
  })

  it('defaults to false when absent', () => {
    expect(Query.parse({}).flag).toBe(false)
  })

  it('rejects anything else', () => {
    expect(QueryBool.safeParse('0').success).toBe(false)
    expect(QueryBool.safeParse('yes').success).toBe(false)
  })
})
