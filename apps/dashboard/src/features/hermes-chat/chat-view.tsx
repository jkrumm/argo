import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Center, Loader } from '@mantine/core'
import type { AgentPart, AgentThread, ChatMessage, ThreadRunState } from 'basalt-ui/agent'
import { hermesQueries } from '../../lib/queries/hermes'
import { getFailedClientMessageIds, getOutboundClientMessageIds } from './hermes-transport'
import { mergeOptimisticMessages, toChatMessage } from './threads-store'
import { ChatConversation } from './chat-conversation'

// The confirmed transcript comes straight from the same per-thread messages query
// every other read in the app uses (`hermesQueries.messages`) — the store's own
// `thread.messages` is deliberately just the OPTIMISTIC OVERLAY (see
// threads-store.ts's header doc), not a full transcript, so it never duplicates
// the confirmed rows once a fetch settles. `mergeOptimisticMessages` reconciles
// the two by an EXACT key (`client_message_id` for user turns, confirmed count for
// assistant turns — see its own doc), never by timestamp or by `ChatMessage.id`
// (message ids never match across the optimistic/confirmed boundary — the server
// always mints its own row id, and the wire id the server DOES echo back as
// `client_message_id` is minted independently of this store's own message id too).
export function ChatView({
  thread,
  run,
  onSend,
  onStop,
}: {
  thread: AgentThread<AgentPart>
  run: ThreadRunState<AgentPart> | undefined
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { data, isLoading } = useQuery(hermesQueries.messages(thread.id))

  const serverMessages = useMemo(
    () =>
      (data?.data ?? [])
        .map((row) => toChatMessage(row))
        .filter((message): message is ChatMessage<AgentPart> => message !== null),
    [data],
  )

  // `data.data` carries `client_message_id` (raw rows) — `serverMessages` above has
  // already dropped it during the `toChatMessage` conversion (basalt's `ChatMessage`
  // has no such field), so it's read straight off `data.data` here instead.
  const confirmedClientMessageIds = useMemo(
    () =>
      new Set(
        (data?.data ?? [])
          .map((row) => row.client_message_id)
          .filter((id): id is string => id !== null),
      ),
    [data],
  )

  // Read fresh on every recompute (never memoized on its own) — see threads-store.ts's
  // header doc: this only needs to be CURRENT at the moment `data` changes (a genuine
  // confirmation can only ever happen alongside a `data` change), which `useMemo`'s own
  // `data` dependency below already guarantees without needing this array's identity
  // to be a tracked dependency itself.
  const messages = useMemo(
    () =>
      mergeOptimisticMessages(
        serverMessages,
        thread.messages,
        confirmedClientMessageIds,
        getOutboundClientMessageIds(thread.id),
        getFailedClientMessageIds(thread.id),
      ),
    [serverMessages, thread.messages, confirmedClientMessageIds, thread.id],
  )

  // Gate the loader on having NOTHING to show yet, not on the fetch itself — a
  // just-sent message is already visible via the optimistic overlay above, and
  // blocking on `isLoading` regardless would flash a spinner over it for exactly
  // as long as the confirmed fetch takes (part of the same "user's own message is
  // invisible" defect this rework fixes, just at a smaller scale).
  if (isLoading && messages.length === 0) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    )
  }

  return (
    <ChatConversation
      thread={thread}
      messages={messages}
      run={run}
      onSend={onSend}
      onStop={onStop}
    />
  )
}
