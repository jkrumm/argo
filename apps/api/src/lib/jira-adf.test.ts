import { describe, it, expect } from 'bun:test'
import { appendFooter, markdownToAdf } from './jira-adf.js'

const BASE = 'https://careerpartner.atlassian.net'

describe('markdownToAdf — block level', () => {
  it('returns an empty doc for empty input', () => {
    const doc = markdownToAdf('', BASE)
    expect(doc.type).toBe('doc')
    expect(doc.version).toBe(1)
    expect(doc.content).toEqual([])
  })

  it('returns an empty doc for null/undefined', () => {
    expect(markdownToAdf(null, BASE).content).toEqual([])
    expect(markdownToAdf(undefined, BASE).content).toEqual([])
  })

  it('wraps a single paragraph', () => {
    const doc = markdownToAdf('hello world', BASE)
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]?.type).toBe('paragraph')
    expect(doc.content[0]?.content?.[0]?.text).toBe('hello world')
  })

  it('splits paragraphs on blank lines', () => {
    const doc = markdownToAdf('first\n\nsecond', BASE)
    expect(doc.content).toHaveLength(2)
    expect(doc.content[0]?.content?.[0]?.text).toBe('first')
    expect(doc.content[1]?.content?.[0]?.text).toBe('second')
  })

  it('joins single-newline lines with a hardBreak', () => {
    const doc = markdownToAdf('line 1\nline 2', BASE)
    expect(doc.content).toHaveLength(1)
    const inline = doc.content[0]?.content ?? []
    expect(inline).toHaveLength(3)
    expect(inline[0]?.text).toBe('line 1')
    expect(inline[1]?.type).toBe('hardBreak')
    expect(inline[2]?.text).toBe('line 2')
  })

  it('emits headings at levels 1–3', () => {
    const doc = markdownToAdf('# h1\n## h2\n### h3', BASE)
    expect(doc.content).toHaveLength(3)
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(doc.content[0]?.content?.[0]?.text).toBe('h1')
    expect(doc.content[1]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(doc.content[2]).toMatchObject({ type: 'heading', attrs: { level: 3 } })
  })

  it('groups consecutive bullet lines into one bulletList', () => {
    const doc = markdownToAdf('- foo\n- bar\n- baz', BASE)
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]?.type).toBe('bulletList')
    expect(doc.content[0]?.content).toHaveLength(3)
    expect(doc.content[0]?.content?.[0]).toMatchObject({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foo' }] }],
    })
  })

  it('accepts both - and * as bullet markers', () => {
    const doc = markdownToAdf('* foo\n* bar', BASE)
    expect(doc.content[0]?.type).toBe('bulletList')
    expect(doc.content[0]?.content).toHaveLength(2)
  })

  it('groups ordered list items', () => {
    const doc = markdownToAdf('1. one\n2. two\n3. three', BASE)
    expect(doc.content[0]?.type).toBe('orderedList')
    expect(doc.content[0]?.content).toHaveLength(3)
  })

  it('emits a fenced code block with the language attribute', () => {
    const doc = markdownToAdf('```ts\nconst x = 1\n```', BASE)
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1' }],
    })
  })

  it('emits a fenced code block without language when none given', () => {
    const doc = markdownToAdf('```\nplain\n```', BASE)
    expect(doc.content[0]?.type).toBe('codeBlock')
    expect(doc.content[0]?.attrs).toBeUndefined()
  })

  it('mixes a heading + paragraph + bullet list in one doc', () => {
    const doc = markdownToAdf(
      '## Context\n\nWe need X.\n\n**Acceptance Criteria:**\n\n- Foo\n- Bar\n- Baz',
      BASE,
    )
    expect(doc.content.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'bulletList',
    ])
  })
})

describe('markdownToAdf — inline marks', () => {
  it('parses **bold**', () => {
    const doc = markdownToAdf('one **two** three', BASE)
    const inline = doc.content[0]?.content ?? []
    expect(inline).toHaveLength(3)
    expect(inline[0]).toMatchObject({ type: 'text', text: 'one ' })
    expect(inline[1]).toMatchObject({
      type: 'text',
      text: 'two',
      marks: [{ type: 'strong' }],
    })
    expect(inline[2]).toMatchObject({ type: 'text', text: ' three' })
  })

  it('parses *italic* and _italic_', () => {
    const a = markdownToAdf('foo *bar* baz', BASE)
    expect(a.content[0]?.content?.[1]).toMatchObject({
      type: 'text',
      text: 'bar',
      marks: [{ type: 'em' }],
    })
    const b = markdownToAdf('foo _bar_ baz', BASE)
    expect(b.content[0]?.content?.[1]).toMatchObject({
      type: 'text',
      text: 'bar',
      marks: [{ type: 'em' }],
    })
  })

  it('parses `inline code`', () => {
    const doc = markdownToAdf('use `bun test`', BASE)
    const code = doc.content[0]?.content?.[1]
    expect(code).toMatchObject({ type: 'text', text: 'bun test', marks: [{ type: 'code' }] })
  })

  it('parses [text](url) as a link', () => {
    const doc = markdownToAdf('see [docs](https://example.com)', BASE)
    expect(doc.content[0]?.content?.[1]).toMatchObject({
      type: 'text',
      text: 'docs',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    })
  })
})

describe('markdownToAdf — issue-key autolink', () => {
  it('converts a bare EP-1234 to an inlineCard', () => {
    const doc = markdownToAdf('blocked by EP-17587 — see comment', BASE)
    const inline = doc.content[0]?.content ?? []
    const card = inline.find((n) => n.type === 'inlineCard')
    expect(card).toMatchObject({
      type: 'inlineCard',
      attrs: { url: `${BASE}/browse/EP-17587` },
    })
  })

  it('converts a /browse/EP-X URL to an inlineCard', () => {
    const doc = markdownToAdf('https://careerpartner.atlassian.net/browse/EP-17587', BASE)
    expect(doc.content[0]?.content?.[0]).toMatchObject({
      type: 'inlineCard',
      attrs: { url: 'https://careerpartner.atlassian.net/browse/EP-17587' },
    })
  })

  it('does NOT match lowercase pseudo-keys', () => {
    const doc = markdownToAdf('not a key: foo-12 nor ABC-bar', BASE)
    const inline = doc.content[0]?.content ?? []
    const cards = inline.filter((n) => n.type === 'inlineCard')
    expect(cards).toHaveLength(0)
  })

  it('emits a plain link for non-browse URLs', () => {
    const doc = markdownToAdf('see https://argo.jkrumm.com/api/health', BASE)
    const link = doc.content[0]?.content?.find((n) => n.marks?.[0]?.type === 'link')
    expect(link).toBeTruthy()
    expect(link?.marks?.[0]?.attrs?.['href']).toBe('https://argo.jkrumm.com/api/health')
  })

  it('autolinks an issue key inside a bullet item', () => {
    const doc = markdownToAdf('- Implements EP-17587\n- See EP-17666', BASE)
    const list = doc.content[0]
    expect(list?.type).toBe('bulletList')
    const firstItemInline = list?.content?.[0]?.content?.[0]?.content
    const card = firstItemInline?.find((n) => n.type === 'inlineCard')
    expect(card).toBeTruthy()
  })
})

describe('appendFooter', () => {
  const FOOTER = "Created by Johannes' personal Hermes Agent"

  it('appends an italic footer paragraph', () => {
    const doc = appendFooter(
      {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      },
      FOOTER,
    )
    expect(doc.content).toHaveLength(2)
    expect(doc.content[1]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: FOOTER, marks: [{ type: 'em' }] }],
    })
  })

  it('does not double-stamp', () => {
    const doc = appendFooter(
      {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: FOOTER }] }],
      },
      FOOTER,
    )
    expect(doc.content).toHaveLength(1)
  })
})
