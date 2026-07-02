import { memo, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import remend from 'remend'
import rehypeSanitize from 'rehype-sanitize'
import { harden } from 'rehype-harden'
import {
  Anchor,
  Badge,
  Blockquote,
  Code,
  Divider,
  List,
  Mark,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { remarkHermesAccents } from './remark-hermes-accents'
import { hermesSanitizeSchema } from './sanitize-schema'
import { parseCard } from './smart-card-schema'
import { SmartCard } from './smart-card'
import { MermaidDiagram } from './mermaid-diagram'
import { VegaLiteDiagram } from './vega-lite-diagram'
import classes from './message-markdown.module.css'

// Full rich renderer for chat messages (Group 6). react-markdown v10 + `remend`
// (auto-completes unterminated **bold** / `code` / fences mid-stream so a partial
// token never flickers as broken syntax) + remark-gfm, with Mantine-native element
// mappings. On top of base markdown:
//   • fenced ` ```card ` JSON → Mantine smart cards (infra/todo/note/audio), bad JSON →
//     graceful code-block fallback;
//   • fenced ` ```mermaid ` / ` ```vega-lite ` → bundled inline diagram components;
//   • inline `:badge[…]` / `==highlight==` accents (remark-hermes-accents);
//   • `rehype-sanitize` (hardened schema) + `rehype-harden` (URL filtering) on all
//     LLM output.
// See docs/HERMES-CHAT-PRD.md → Rendering + Security.

// Accent color the directive carried, encoded as a `c-<color>` className by the
// remark plugin (constrained to the DESIGN.md identity set).
function HermesBadge({ className, children }: { className?: string; children?: ReactNode }) {
  const color = /\bc-([a-z]+)\b/.exec(className ?? '')?.[1] ?? 'gray'
  return (
    <Badge component="span" size="sm" variant="light" color={color} radius="sm">
      {children}
    </Badge>
  )
}

// Extract a fenced block's language (`language-card` → `card`).
function blockLang(className: string | undefined): string | undefined {
  return /language-([\w-]+)/.exec(className ?? '')?.[1]
}

// Only `children` (+ the few attrs we actually need) are forwarded — the raw
// intrinsic-element props carry element-specific `ref` types that fight Mantine's.
// These are stable module-scope components (no per-render closure).
const baseComponents: Components = {
  h1: ({ children }) => (
    <Title order={3} fw="bold">
      {children}
    </Title>
  ),
  h2: ({ children }) => (
    <Title order={4} fw="bold">
      {children}
    </Title>
  ),
  h3: ({ children }) => (
    <Title order={5} fw="semibold">
      {children}
    </Title>
  ),
  h4: ({ children }) => (
    <Title order={6} fw="semibold">
      {children}
    </Title>
  ),
  h5: ({ children }) => (
    <Title order={6} fw="semibold">
      {children}
    </Title>
  ),
  h6: ({ children }) => (
    <Title order={6} fw="semibold">
      {children}
    </Title>
  ),
  p: ({ children }) => <Text size="sm">{children}</Text>,
  a: ({ href, children }) => (
    <Anchor href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Anchor>
  ),
  ul: ({ children }) => <List size="sm">{children}</List>,
  ol: ({ children }) => (
    <List size="sm" type="ordered">
      {children}
    </List>
  ),
  li: ({ children }) => <List.Item>{children}</List.Item>,
  blockquote: ({ children }) => (
    <Blockquote p="xs" my="xs">
      {children}
    </Blockquote>
  ),
  hr: () => <Divider my="xs" />,
  // The fenced block's <pre> wrapper is redundant — Code block renders its own.
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <Table striped withTableBorder withColumnBorders>
      {children}
    </Table>
  ),
  thead: ({ children }) => <Table.Thead>{children}</Table.Thead>,
  tbody: ({ children }) => <Table.Tbody>{children}</Table.Tbody>,
  tr: ({ children }) => <Table.Tr>{children}</Table.Tr>,
  th: ({ children }) => <Table.Th>{children}</Table.Th>,
  td: ({ children }) => <Table.Td>{children}</Table.Td>,
}

// Known mappings + the two custom inline-accent elements emitted by
// remark-hermes-accents. Custom tag names aren't in react-markdown's element-keyed
// `Components` type, so the merge is cast at the boundary.
const MarkComponent = ({ children }: { children?: ReactNode }) => <Mark>{children}</Mark>

const richBaseComponents: Components = {
  ...baseComponents,
  'hermes-badge': HermesBadge,
  'hermes-mark': MarkComponent,
} as Components

// rehype-harden filters link/image URLs (blocks javascript:/file: always). Links
// may point anywhere on the homelab, so allow all http(s)/relative; dangerous
// protocols stay blocked regardless. rehype-sanitize (hardened schema) strips any
// disallowed tag/attribute first.
const HARDEN_OPTIONS = {
  allowedLinkPrefixes: ['*'],
  allowedImagePrefixes: ['*'],
  allowDataImages: true,
}

// Build the code component for a specific messageId/threadId context so SmartCard
// receives stable routing props for its audio player.
function buildCodeComponent(messageId?: string, threadId?: string): Components['code'] {
  return ({ className, children }) => {
    const text = String(children ?? '')
    const lang = blockLang(className)
    // Smart card: parse JSON → Mantine card; invalid/unknown → code-block fallback
    // (never throws). `remend` defers incomplete fences, so a half-streamed block
    // stays valid until it closes.
    if (lang === 'card') {
      const card = parseCard(text)
      return card ? (
        <SmartCard card={card} messageId={messageId} threadId={threadId} />
      ) : (
        <Code block className={className}>
          {text.replace(/\n$/, '')}
        </Code>
      )
    }
    if (lang === 'mermaid') return <MermaidDiagram source={text} />
    if (lang === 'vega-lite') return <VegaLiteDiagram source={text} />
    // v10 dropped the `inline` prop; a fenced block carries a `language-*` class
    // or spans multiple lines — everything else is inline code.
    const isBlock = (className?.startsWith('language-') ?? false) || text.includes('\n')
    return isBlock ? (
      <Code block className={className}>
        {text.replace(/\n$/, '')}
      </Code>
    ) : (
      <Code className={className}>{children}</Code>
    )
  }
}

function MessageMarkdownImpl({
  content,
  messageId,
  threadId,
}: {
  content: string
  messageId?: string
  threadId?: string
}) {
  // Merge the context-aware code handler over the stable base map.
  const components: Components = {
    ...richBaseComponents,
    code: buildCodeComponent(messageId, threadId),
  }

  return (
    <div className={classes.prose}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkHermesAccents]}
        rehypePlugins={[
          [rehypeSanitize, hermesSanitizeSchema],
          [harden, HARDEN_OPTIONS],
        ]}
        components={components}
      >
        {remend(content)}
      </Markdown>
    </div>
  )
}

// Memoized: a streaming turn re-renders the whole list on every token; only the
// message whose `content` actually changed needs to re-parse.
export const MessageMarkdown = memo(MessageMarkdownImpl)
