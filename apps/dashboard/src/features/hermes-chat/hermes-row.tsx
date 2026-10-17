import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ThreadFeedRow,
  type AgentPart,
  type AgentThread,
  type ComposerHandle,
  type ThreadRunState,
} from 'basalt-ui/agent'
import { hermesQueries } from '../../lib/queries/hermes'
import { isThreadPersisted, mergeOptimisticMessages, toChatMessage } from './threads-store'
import type { HermesChatMessage } from './threads-store'
import { hermesThreadRenderers } from './thread-renderers'
import { useHermesThreadVoice } from './use-hermes-thread-voice'
import classes from './hermes-row.module.css'

// The open Hermes thread: adopts basalt's own `ThreadFeedRow` (1.29.0) for the lazy-mount/
// transcript/composer shell, and supplies only what's genuinely app-specific — the confirmed-vs-
// optimistic message merge and voice. The row's own header is hidden: the thread's title, type and
// facts live in `ThreadRecordHeader` (the list in `ThreadList` is where threads are chosen), so
// this renders the transcript and composer only.

export function HermesRow({
  thread,
  height,
  run,
  onSend,
  onStop,
}: {
  thread: AgentThread<AgentPart>
  /** The transcript's bounded height (basalt's `RowHeightProps` B3 mode: `height` alone wraps it in
   * its own `BasaltStickToBottom`); the composer sits right under it. */
  height: string
  run: ThreadRunState<AgentPart> | undefined
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { data } = useQuery({
    ...hermesQueries.messages(thread.id),
    enabled: isThreadPersisted(thread),
  })

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

  return (
    <ThreadFeedRow
      thread={thread}
      messages={messages}
      expanded
      onToggle={() => {}}
      height={height}
      classNames={classes['header'] !== undefined ? { header: classes['header'] } : {}}
      {...(run?.parts !== undefined && { liveParts: run.parts })}
      {...(run !== undefined && { liveStatus: run.status })}
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
