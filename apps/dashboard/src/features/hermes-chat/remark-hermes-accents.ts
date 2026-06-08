import { visit } from 'unist-util-visit'
import type { Root, RootContent } from 'mdast'

// Inline accents for Hermes output. Two surfaces, one plugin:
//   • `:badge[Label]{color="green"}`  — a `remark-directive` text directive → a
//     Mantine `<Badge>` (mapped via the `hermes-badge` element in message-markdown).
//   • `==highlight==`                 — a plain-text mark (not directive syntax) →
//     a `<mark>`-like `hermes-mark` element.
// Both emit custom hast elements that the sanitize schema allowlists and the
// react-markdown `components` map renders Mantine-native. Unhandled directives
// degrade to a passthrough span/div so a stray `:foo` never drops content.
// See docs/HERMES-CHAT-PRD.md → Rendering.

// Accent colors the badge may carry — constrained to the DESIGN.md identity set
// (blue/gray + status hues). Anything else collapses to neutral gray.
const BADGE_COLORS = new Set(['blue', 'gray', 'red', 'green', 'orange', 'yellow'])

// `==text==` — avoid matching `=` runs and require non-`=` inner content.
const HIGHLIGHT = /==([^=\n]+)==/g

// remark-directive node shape (not in the base mdast types). Accessed via a cast.
type DirectiveNode = {
  type: 'textDirective' | 'leafDirective' | 'containerDirective'
  name: string
  attributes?: Record<string, string | null | undefined> | null
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective'])

export function remarkHermesAccents() {
  return (tree: Root) => {
    // 1. `==highlight==` → hermes-mark. Mutates `parent.children` in place; we
    //    return the next index past the spliced nodes so visit doesn't re-scan
    //    (and never loops on the freshly-inserted text).
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value
      if (!value.includes('==')) return

      HIGHLIGHT.lastIndex = 0
      const replacement: RootContent[] = []
      let last = 0
      let match: RegExpExecArray | null
      while ((match = HIGHLIGHT.exec(value)) !== null) {
        if (match.index > last) {
          replacement.push({ type: 'text', value: value.slice(last, match.index) })
        }
        // hermesMark is a custom node rendered via data.hName by mdast-util-to-hast.
        replacement.push({
          type: 'hermesMark',
          data: { hName: 'hermes-mark' },
          children: [{ type: 'text', value: match[1] }],
        } as unknown as RootContent)
        last = HIGHLIGHT.lastIndex
      }
      if (replacement.length === 0) return
      if (last < value.length) {
        replacement.push({ type: 'text', value: value.slice(last) })
      }
      parent.children.splice(index, 1, ...replacement)
      return index + replacement.length
    })

    // 2. Directives → custom elements (or a safe passthrough for unknown names).
    visit(tree, (node) => {
      if (!DIRECTIVE_TYPES.has(node.type)) return
      const directive = node as unknown as DirectiveNode
      const data = directive.data ?? (directive.data = {})
      if (directive.name === 'badge') {
        const raw = directive.attributes?.color ?? 'blue'
        const color = raw && BADGE_COLORS.has(raw) ? raw : 'gray'
        data.hName = 'hermes-badge'
        data.hProperties = { className: ['hermes-badge', `c-${color}`] }
      } else {
        // Unknown directive: keep its content, drop the directive semantics.
        data.hName = directive.type === 'containerDirective' ? 'div' : 'span'
      }
    })
  }
}
