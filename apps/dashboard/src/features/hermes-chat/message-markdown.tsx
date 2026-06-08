import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remend from 'remend'
import { Anchor, Blockquote, Code, Divider, List, Table, Text, Title } from '@mantine/core'
import classes from './message-markdown.module.css'

// Base streaming-safe markdown render for chat messages. react-markdown v10 +
// `remend` (auto-completes unterminated **bold** / `code` / fences mid-stream so
// the partial token never flickers as broken syntax) + remark-gfm, with
// Mantine-native element mappings. Smart `card` / `mermaid` / `vega-lite` blocks
// are NOT special-cased here — they fall through to the plain code-block renderer
// for now; Group 6 replaces that. See docs/HERMES-CHAT-PRD.md.

// Only `children` (+ the few attrs we actually need) are forwarded — the raw
// intrinsic-element props carry element-specific `ref` types that fight Mantine's.
const components: Components = {
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
  code: ({ className, children }) => {
    const text = String(children ?? '')
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
  },
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

function MessageMarkdownImpl({ content }: { content: string }) {
  return (
    <div className={classes.prose}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {remend(content)}
      </Markdown>
    </div>
  )
}

// Memoized: a streaming turn re-renders the whole list on every token; only the
// message whose `content` actually changed needs to re-parse.
export const MessageMarkdown = memo(MessageMarkdownImpl)
