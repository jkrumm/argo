import { describe, expect, it } from 'bun:test'
// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5; this test drives the finish-reason-transform module (the legitimate v5/v7-skew neutralization point) with real UIMessageChunk values (docs/HERMES-CHAT-V2.md).
import type { UIMessageChunk } from 'ai'
import { rewriteUnknownFinishReason } from './finish-reason-transform.js'

// Read directly off ai@7's finish-chunk `z.strictObject` enum
// (apps/dashboard/node_modules/ai/dist/index.js:6395-6406) — kept independent of the
// module under test's own V7_ACCEPTED_FINISH_REASONS constant, so a bug that mutates
// both in lockstep can't hide from this test.
const V7_SCHEMA_FINISH_REASONS = [
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
] as const

describe('rewriteUnknownFinishReason', () => {
  it("rewrites 'unknown' to 'other'", () => {
    const chunk: UIMessageChunk = { type: 'finish', finishReason: 'unknown' }
    expect(rewriteUnknownFinishReason(chunk)).toEqual({ type: 'finish', finishReason: 'other' })
  })

  for (const finishReason of V7_SCHEMA_FINISH_REASONS) {
    it(`passes '${finishReason}' through unchanged`, () => {
      const chunk: UIMessageChunk = { type: 'finish', finishReason }
      expect(rewriteUnknownFinishReason(chunk)).toEqual(chunk)
    })
  }

  it('leaves an absent finishReason untouched (v7 treats it as optional)', () => {
    const chunk: UIMessageChunk = { type: 'finish' }
    expect(rewriteUnknownFinishReason(chunk)).toEqual({ type: 'finish' })
  })

  it('passes a non-finish chunk through byte-for-byte', () => {
    const chunk: UIMessageChunk = { type: 'text-delta', id: 'msg_1', delta: 'hello' }
    expect(rewriteUnknownFinishReason(chunk)).toBe(chunk)
  })

  it('passes a finish-step chunk through unchanged (no finishReason field to rewrite)', () => {
    const chunk: UIMessageChunk = { type: 'finish-step' }
    expect(rewriteUnknownFinishReason(chunk)).toBe(chunk)
  })

  it('preserves messageMetadata while rewriting an unknown finishReason', () => {
    const chunk: UIMessageChunk = {
      type: 'finish',
      finishReason: 'unknown',
      messageMetadata: { foo: 'bar' },
    }
    expect(rewriteUnknownFinishReason(chunk)).toEqual({
      type: 'finish',
      finishReason: 'other',
      messageMetadata: { foo: 'bar' },
    })
  })

  it('preserves messageMetadata on an already-legal finishReason', () => {
    const chunk: UIMessageChunk = {
      type: 'finish',
      finishReason: 'stop',
      messageMetadata: { foo: 'bar' },
    }
    expect(rewriteUnknownFinishReason(chunk)).toEqual(chunk)
  })
})
