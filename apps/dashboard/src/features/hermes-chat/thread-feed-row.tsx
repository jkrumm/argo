import { useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { Badge, Box, Group, Loader, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconPin } from '@tabler/icons-react'
import type { AgentPart, AgentThread, ThreadRunState } from 'basalt-ui/agent'
import type { HermesThreadType } from '../../lib/queries/hermes'
import { ChatView } from './chat-view'
import classes from './thread-feed-row.module.css'

// D-F / the mount-lifecycle invariant this component exists to guarantee (copied verbatim from
// basalt's own `ThreadFeedRow`, node_modules/basalt-ui/src/agent-chat/thread-feed-row.tsx — read
// its module doc before touching this): once a row has been expanded for the first time, its
// transcript+composer subtree mounts LAZILY and then STAYS MOUNTED for the row's lifetime.
// Collapsing hides it with CSS only (`display: none`); it never unmounts. This is deliberately
// NOT delegated to Mantine's `Collapse` — a bare `<Collapse expanded>` on `@mantine/core@9.3.0`
// happens to keep children mounted (hidden via `display: none` from `useCollapse`), but Mantine
// master has already moved the defaults to `keepMounted: true` + `keepMountedMode: 'activity'`,
// wrapping children in React 19 `<Activity mode="hidden">` — which DESTROYS effects on hide and
// RE-CREATES them on show. For a streaming transport's resume/subscription effect that is a
// literal duplicate stream replay (the exact defect this file replaces). Own it here in plain CSS
// so an upstream Mantine default change can never flip this out from under the chat.
//
// Named `HermesThreadRow`, not `ThreadFeedRow`: basalt-ui 1.20.0's `basalt/shadow-basalt-export`
// flags a local component whose name collides with a live basalt export, and it is right to — the
// name claimed to be the shipped composite while being a fork. The fork itself stays, for the
// reasons below; only the misleading name goes.
//
// We don't use basalt's own `ThreadFeedRow`/`ThreadFeed` composite (though both are on the
// program's frozen-import allowlist): its header hardcodes `thread.outcome?.title ?? 'Untitled
// thread'` (node_modules/basalt-ui/src/agent-chat/thread-feed-row.tsx, `rowTitle`) and has no pin/
// type-badge slot. Argo's title is server-computed asynchronously and deliberately never routed
// through `setOutcome` (hermes-transport.ts's `resolveHermesOutcome` — writing a guessed title
// there would clobber the server's real one), so `thread.outcome` is never populated here; and
// pin/type badges are load-bearing existing UI the brief keeps ("Argo's pin/rename already exist
// end-to-end… drive them OUT-OF-BAND alongside the store"). This file composes the same lower-level
// primitives (`ThreadTranscript` + `Composer`, via `ChatView`/`ChatConversation`) with our own
// header instead.

// Allowed Mantine accents only (DESIGN.md: no teal/violet/grape/indigo/pink).
const TYPE_COLOR: Record<HermesThreadType, string> = {
  todo: 'blue',
  podcast: 'orange',
  infra: 'gray',
  note: 'yellow',
  research: 'green',
  general: 'gray',
}

const TYPE_LABEL: Record<HermesThreadType, string> = {
  todo: 'Todo',
  podcast: 'Podcast',
  infra: 'Infra',
  note: 'Note',
  research: 'Research',
  general: 'General',
}

// Height of the inline conversation pane — bounded so the feed remains navigable.
const CONV_HEIGHT = 480

function metaString(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function HermesThreadRow({
  thread,
  expanded,
  onToggle,
  run,
  onSend,
  onStop,
}: {
  thread: AgentThread<AgentPart>
  expanded: boolean
  onToggle: () => void
  run: ThreadRunState<AgentPart> | undefined
  onSend: (text: string) => void
  onStop: () => void
}) {
  const title = metaString(thread.meta, 'title') ?? 'New chat'
  const summary = metaString(thread.meta, 'summary')
  const type = thread.meta?.type as HermesThreadType | null | undefined
  const pinned = thread.meta?.pinned === true

  // Lazy-mount-keep-mounted: set during render (not an effect) so the header and the newly
  // lazy-mounted body commit in the SAME paint — see the module doc above.
  const [hasOpened, setHasOpened] = useState(expanded)
  if (expanded && !hasOpened) setHasOpened(true)

  return (
    <Box className={classes.wrapper} data-expanded={expanded || undefined}>
      <UnstyledButton className={classes.header} onClick={onToggle} aria-expanded={expanded}>
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          {pinned && <IconPin size={12} className={classes.pin} />}
          {type && (
            <Badge
              size="xs"
              variant="light"
              color={TYPE_COLOR[type]}
              radius="sm"
              style={{ flexShrink: 0 }}
            >
              {TYPE_LABEL[type]}
            </Badge>
          )}
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw="semibold" lineClamp={1}>
              {title}
            </Text>
            {summary && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {summary}
              </Text>
            )}
          </Box>
        </Group>
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          {/* Collapsed-only: once expanded, ChatConversation's own composer already shows the
              live/stop state — a second indicator here would be redundant chrome. */}
          {!expanded && thread.status === 'streaming' && (
            <Loader size="xs" color="gray" aria-label="Generating" />
          )}
          <Text size="xs" c="dimmed">
            {formatDistanceToNowStrict(new Date(thread.updatedAt), { addSuffix: false })}
          </Text>
          {expanded ? (
            <IconChevronDown size={14} className={classes.chevron} />
          ) : (
            <IconChevronRight size={14} className={classes.chevron} />
          )}
        </Group>
      </UnstyledButton>

      {hasOpened && (
        <Box
          className={classes.conversationWrapper}
          h={CONV_HEIGHT}
          style={{ display: expanded ? 'block' : 'none' }}
        >
          <ChatView thread={thread} run={run} onSend={onSend} onStop={onStop} />
        </Box>
      )}
    </Box>
  )
}
