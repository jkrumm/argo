import type { ReactNode } from 'react'
import { Badge, Mark } from '@mantine/core'
import remarkDirective from 'remark-directive'
import { Markdown, type FenceRenderers, type MarkdownComponents } from 'basalt-ui/content'
import type { ForeignPart, PartRenderer, PartRenderers } from 'basalt-ui/agent'
import { remarkHermesAccents } from './remark-hermes-accents'
import { hermesSanitizeSchema } from './sanitize-schema'
import { cardFenceRenderer } from './smart-card'
import { vegaLiteFenceRenderer } from './vega-lite-diagram'

// The seam basalt-ui itself documents for reaching Markdown's fence registry through the
// agent-chat chrome: ThreadTranscript/ThreadDetailPanel/ThreadWorkspace expose no markdown-config
// prop of their own, and the built-in TextRenderer hardcodes
// `<Markdown streaming contentTrust density>` with no fence registry. Overriding the `text` part
// renderer via ThreadTranscript's `renderers` prop (consulted BEFORE the built-in union — a
// consumer key always wins) is the documented workaround. See docs/HERMES-CHAT-PRD.md →
// Rendering.

// Accent color the badge directive carried, encoded as a `c-<color>` className by
// remark-hermes-accents.ts (constrained to the DESIGN.md identity set).
function HermesBadge({ className, children }: { className?: string; children?: ReactNode }) {
  const color = /\bc-([a-z]+)\b/.exec(className ?? '')?.[1] ?? 'gray'
  return (
    <Badge component="span" size="sm" variant="light" color={color} radius="sm">
      {children}
    </Badge>
  )
}

function HermesMark({ children }: { children?: ReactNode }) {
  return <Mark>{children}</Mark>
}

// react-markdown's `Components` type is a mapped type over `JSX.IntrinsicElements` — a custom tag
// admitted via `sanitizeSchema.tagNames` (hermes-badge/hermes-mark) has no slot in it, so the
// merge is cast at the boundary. Module-scope + stable.
const hermesComponents = {
  'hermes-badge': HermesBadge,
  'hermes-mark': HermesMark,
} as MarkdownComponents

// Module-scope + referentially stable — `fenceRenderers` participates in Markdown's streaming
// memoization. Deliberately does NOT register a `mermaid` key: the built-in `settledOnly(...)`-
// wrapped mermaid renderer (beautiful-mermaid) already handles it correctly, and a consumer key
// would win over — and shadow — that built-in.
export const hermesFenceRenderers: FenceRenderers = {
  card: cardFenceRenderer,
  'vega-lite': vegaLiteFenceRenderer,
}

// Module-scope + referentially stable, same reason.
const HERMES_REMARK_PLUGINS = [remarkDirective, remarkHermesAccents]

// `ThreadTranscript`'s `renderers` prop resolves `PartRenderContext` (`{ part, messageId, partId,
// settled, role }`), not `PartListProps`'s `{ part, index, settled }` — the two per-renderer
// argument shapes basalt ships are different despite both gating on `settled`. `part` here is
// typed as the loose `ForeignPart` (`{ type: string; id: string; [k: string]: unknown }`) because
// argo has not augmented `BasaltRegister.parts`; at runtime, keying this map by the literal
// string `'text'` means it only ever receives basalt's own built-in TextPart, so the index-
// signature read below is safe despite the static type being `unknown`.
const hermesTextRenderer: PartRenderer<ForeignPart> = ({ part, settled }) => {
  const text = typeof part['text'] === 'string' ? part['text'] : ''
  return (
    <Markdown
      streaming={!settled}
      contentTrust="untrusted"
      density="chat"
      fenceRenderers={hermesFenceRenderers}
      remarkPlugins={HERMES_REMARK_PLUGINS}
      sanitizeSchema={hermesSanitizeSchema}
      components={hermesComponents}
    >
      {text}
    </Markdown>
  )
}

// Frozen export names — consumed by ThreadTranscript's `renderers` prop elsewhere in the program.
export const hermesRenderers: PartRenderers = {
  text: hermesTextRenderer,
}
