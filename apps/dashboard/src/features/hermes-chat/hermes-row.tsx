import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Group, Loader } from '@mantine/core'
import { IconPin } from '@tabler/icons-react'
import { ThreadFeedRow } from 'basalt-ui/agent-chat'
import type { ComposerHandle } from 'basalt-ui/agent-chat'
import type { AgentPart, AgentThread, ThreadRunState } from 'basalt-ui/agent'
import { hermesQueries } from '../../lib/queries/hermes'
import type { HermesThreadType } from '../../lib/queries/hermes'
import { mergeOptimisticMessages, toChatMessage } from './threads-store'
import type { HermesChatMessage } from './threads-store'
import { hermesThreadRenderers } from './thread-renderers'
import { useHermesThreadVoice } from './use-hermes-thread-voice'
import classes from './hermes-row.module.css'

// One Hermes thread row: adopts basalt's own `ThreadFeedRow` (1.29.0) for the header/lazy-mount/
// transcript/composer shell, and supplies only what's genuinely app-specific — the server-owned
// title/summary (never routed through basalt's `outcome` — argo's title is computed
// asynchronously server-side and never guessed client-side), the pin/type badge, the
// confirmed-vs-optimistic message merge, and voice.

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

// Bounded, auto-scrolling body height (basalt's `RowHeightProps` B3 mode — `height` alone, no
// `virtualize` — wraps the transcript in its own `BasaltStickToBottom`).
const ROW_HEIGHT = 480

function metaString(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function HermesRow({
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
  // Lazy-mount-keep-mounted: set during render (not an effect) so the header and the newly
  // lazy-mounted body commit in the SAME paint — mirrors basalt's own ThreadFeedRow internal state,
  // but this component needs its own copy to gate the messages query below.
  const [hasOpened, setHasOpened] = useState(expanded)
  if (expanded && !hasOpened) setHasOpened(true)

  const { data } = useQuery({ ...hermesQueries.messages(thread.id), enabled: hasOpened })

  const serverMessages = useMemo(
    () =>
      (data?.data ?? [])
        .map((row) => toChatMessage(row))
        .filter((message): message is HermesChatMessage => message !== null),
    [data],
  )

  const messages = useMemo(
    () => mergeOptimisticMessages(serverMessages, thread.messages),
    [serverMessages, thread.messages],
  )

  const composerRef = useRef<ComposerHandle>(null)
  const voice = useHermesThreadVoice({ thread, run, composerRef, onSend })

  const title = metaString(thread.meta, 'title') ?? 'New chat'
  const summary = metaString(thread.meta, 'summary') ?? undefined
  const type = thread.meta?.type as HermesThreadType | null | undefined
  const pinned = thread.meta?.pinned === true

  return (
    <ThreadFeedRow
      thread={thread}
      messages={messages}
      expanded={expanded}
      onToggle={() => onToggle()}
      title={title}
      summary={summary}
      headerLeft={
        pinned || type ? (
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
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
          </Group>
        ) : undefined
      }
      headerRight={
        !expanded && thread.status === 'streaming' ? (
          <Loader size="xs" color="gray" aria-label="Generating" />
        ) : null
      }
      height={ROW_HEIGHT}
      classNames={{ header: classes.header, body: classes.body }}
      liveParts={run?.parts}
      liveStatus={run ? 'streaming' : undefined}
      onSend={(payload) => onSend(payload.text)}
      onStop={onStop}
      renderers={hermesThreadRenderers}
      affordances={voice.affordances}
      composerProps={{
        ref: composerRef,
        draftKey: `hermes-thread-${thread.id}`,
        placeholder: 'Message Hermes…',
        rightSection: voice.rightSection,
        leftSection: voice.recordingIndicator,
      }}
    />
  )
}
