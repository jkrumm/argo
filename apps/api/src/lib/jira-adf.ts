// Markdown-subset → Atlassian Document Format (ADF).
//
// Agents compose ticket bodies in Markdown because that's the natural
// shape. Jira's REST v3 only accepts ADF JSON. This file is the bridge.
//
// Supported subset (block):
//   `# `, `## `, `### `       → heading levels 1/2/3
//   ``` ```/```lang/``` ```    → fenced code block (language optional)
//   `- ` or `* `              → bullet list (consecutive lines = one list)
//   `1. `, `2. ` ...           → ordered list
//   blank line                → paragraph break
//   single \n inside paragraph → hard break (preserves intent like "Line 1\nLine 2")
//
// Supported subset (inline):
//   **bold**                  → strong mark
//   *italic* / _italic_       → em mark
//   `code`                    → code mark
//   [text](url)               → text with link mark
//   bare https?://... URL     → text with link mark
//   /<base>/browse/EP-1234    → inlineCard (Jira smart-link)
//   bare EP-1234 (any PROJ-N) → inlineCard, URL = `${baseUrl}/browse/<key>`
//
// Deliberately NOT supported: blockquotes, tables, nested lists, task
// lists, strikethrough, images, HTML, link references. If those land in
// agent output they'll come through as literal characters — surface the
// gap rather than silently approximate.

export interface AdfNode {
  type: string
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  content?: AdfNode[]
  attrs?: Record<string, unknown>
}

export interface AdfDoc {
  type: 'doc'
  version: 1
  content: AdfNode[]
}

// Inline tokenization. Single-pass over a single line of text (or a hard-break
// joined paragraph chunk). We find the earliest match of any inline syntax,
// emit the preceding plain text as a text node, then emit the match as the
// appropriate node, then recurse on the remainder.
//
// Order of alternatives matters when matches start at the same position:
// **bold** must beat *italic* (the parser tries them in order). Inline code
// disables further parsing inside the backticks — Jira's ADF code mark is a
// plain text node with a `code` mark, no nested syntax allowed.

interface InlineRule {
  name: string
  re: RegExp
  build: (m: RegExpMatchArray, baseUrl: string) => AdfNode
}

function makeText(
  text: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
): AdfNode {
  return marks && marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

// Order matters — longer/more-specific syntax first.
const INLINE_RULES: InlineRule[] = [
  {
    name: 'bold',
    re: /\*\*([^*\n]+?)\*\*/,
    build: (m) => makeText(m[1]!, [{ type: 'strong' }]),
  },
  {
    name: 'code',
    re: /`([^`\n]+?)`/,
    build: (m) => makeText(m[1]!, [{ type: 'code' }]),
  },
  {
    name: 'link',
    re: /\[([^\]\n]+)\]\(([^()\s]+)\)/,
    build: (m) => makeText(m[1]!, [{ type: 'link', attrs: { href: m[2]! } }]),
  },
  {
    name: 'em-star',
    re: /(?<![*\w])\*([^*\n]+?)\*(?!\w)/,
    build: (m) => makeText(m[1]!, [{ type: 'em' }]),
  },
  {
    name: 'em-underscore',
    re: /(?<![_\w])_([^_\n]+?)_(?!\w)/,
    build: (m) => makeText(m[1]!, [{ type: 'em' }]),
  },
  {
    // Browse URL — emit inlineCard for any /browse/<KEY> link, even if the
    // host doesn't match our configured base (cross-tenant pastes still
    // render correctly).
    name: 'browse-url',
    re: /(https?:\/\/[^\s)]+\/browse\/[A-Z][A-Z0-9]+-\d+)/,
    build: (m) => ({ type: 'inlineCard', attrs: { url: m[1]! } }),
  },
  {
    // Generic bare URL (not a browse link) — plain link mark.
    name: 'url',
    re: /(https?:\/\/[^\s)]+)/,
    build: (m) => makeText(m[1]!, [{ type: 'link', attrs: { href: m[1]! } }]),
  },
  {
    // Bare issue key. Requires uppercase project prefix to avoid catching
    // English words. Word-boundary on both sides.
    name: 'issue-key',
    re: /\b([A-Z][A-Z0-9]+-\d+)\b/,
    build: (m, baseUrl) => ({
      type: 'inlineCard',
      attrs: { url: `${trimSlash(baseUrl)}/browse/${m[1]!}` },
    }),
  },
]

function tokenizeInline(text: string, baseUrl: string): AdfNode[] {
  const out: AdfNode[] = []
  let rest = text
  while (rest.length > 0) {
    let earliest: { rule: InlineRule; match: RegExpMatchArray; index: number } | null = null
    for (const rule of INLINE_RULES) {
      const m = rest.match(rule.re)
      if (m && m.index !== undefined) {
        if (earliest === null || m.index < earliest.index) {
          earliest = { rule, match: m, index: m.index }
          if (m.index === 0) break // can't beat 0
        }
      }
    }
    if (earliest === null) {
      out.push(makeText(rest))
      break
    }
    if (earliest.index > 0) {
      out.push(makeText(rest.slice(0, earliest.index)))
    }
    out.push(earliest.rule.build(earliest.match, baseUrl))
    rest = rest.slice(earliest.index + earliest.match[0].length)
  }
  return out
}

// Build the inline content for a multi-line block (paragraph, heading, list item).
// Single newlines inside the block become hardBreak nodes; each line's text is
// tokenized for inline marks.
function buildInlineContent(lines: string[], baseUrl: string): AdfNode[] {
  const out: AdfNode[] = []
  lines.forEach((line, idx) => {
    if (line.length > 0) out.push(...tokenizeInline(line, baseUrl))
    if (idx < lines.length - 1) out.push({ type: 'hardBreak' })
  })
  return out
}

// Block-level state machine. Walks lines once and emits ADF top-level nodes.

interface BlockBuf {
  kind: 'paragraph' | 'bullet' | 'ordered'
  lines: string[] // for paragraph: the lines (joined with hardBreak); for lists: each entry is one item's text
}

const HEADING_RE = /^(#{1,3})\s+(.+)$/
const FENCE_RE = /^```(\w*)\s*$/
const BULLET_RE = /^[-*]\s+(.+)$/
const ORDERED_RE = /^\d+\.\s+(.+)$/

function flush(buf: BlockBuf | null, baseUrl: string, out: AdfNode[]): void {
  if (!buf) return
  if (buf.kind === 'paragraph') {
    const content = buildInlineContent(buf.lines, baseUrl)
    if (content.length > 0) out.push({ type: 'paragraph', content })
  } else {
    const listType = buf.kind === 'bullet' ? 'bulletList' : 'orderedList'
    out.push({
      type: listType,
      content: buf.lines.map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: tokenizeInline(item, baseUrl) }],
      })),
    })
  }
}

export function markdownToAdf(input: string | null | undefined, baseUrl: string): AdfDoc {
  const blocks: AdfNode[] = []
  const text = (input ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '')
  if (text.length === 0) return { type: 'doc', version: 1, content: [] }

  const lines = text.split('\n')
  let buf: BlockBuf | null = null
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    // Blank line → flush current block buffer.
    if (line.trim().length === 0) {
      flush(buf, baseUrl, blocks)
      buf = null
      i += 1
      continue
    }

    // Fenced code block — flush whatever's buffered, then consume until close fence.
    const fence = line.match(FENCE_RE)
    if (fence) {
      flush(buf, baseUrl, blocks)
      buf = null
      const lang = fence[1] && fence[1].length > 0 ? fence[1] : undefined
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i]!.match(FENCE_RE)) {
        codeLines.push(lines[i]!)
        i += 1
      }
      i += 1 // skip the closing fence (if present)
      blocks.push({
        type: 'codeBlock',
        ...(lang ? { attrs: { language: lang } } : {}),
        content: [{ type: 'text', text: codeLines.join('\n') }],
      })
      continue
    }

    // Heading — flush, emit, continue.
    const heading = line.match(HEADING_RE)
    if (heading) {
      flush(buf, baseUrl, blocks)
      buf = null
      const level = heading[1]!.length
      blocks.push({
        type: 'heading',
        attrs: { level },
        content: tokenizeInline(heading[2]!, baseUrl),
      })
      i += 1
      continue
    }

    const bullet = line.match(BULLET_RE)
    if (bullet) {
      if (buf?.kind !== 'bullet') {
        flush(buf, baseUrl, blocks)
        buf = { kind: 'bullet', lines: [] }
      }
      buf.lines.push(bullet[1]!)
      i += 1
      continue
    }

    const ordered = line.match(ORDERED_RE)
    if (ordered) {
      if (buf?.kind !== 'ordered') {
        flush(buf, baseUrl, blocks)
        buf = { kind: 'ordered', lines: [] }
      }
      buf.lines.push(ordered[1]!)
      i += 1
      continue
    }

    // Plain line — start/continue paragraph (hard break for consecutive lines).
    if (buf?.kind !== 'paragraph') {
      flush(buf, baseUrl, blocks)
      buf = { kind: 'paragraph', lines: [] }
    }
    buf.lines.push(line)
    i += 1
  }
  flush(buf, baseUrl, blocks)

  return { type: 'doc', version: 1, content: blocks }
}

// Append the Hermes attribution footer as a trailing italic paragraph.
// Doc must be ADF; mutates a copy, not the input.
export function appendFooter(doc: AdfDoc, footerText: string): AdfDoc {
  const flat = JSON.stringify(doc)
  if (flat.includes(footerText)) return doc
  return {
    type: 'doc',
    version: 1,
    content: [
      ...doc.content,
      {
        type: 'paragraph',
        content: [{ type: 'text', text: footerText, marks: [{ type: 'em' }] }],
      },
    ],
  }
}
