import { useQuery } from '@tanstack/react-query'
import { Center, Loader } from '@mantine/core'
import { hermesQueries, type HermesMessage, type HermesThread } from '../../lib/queries/hermes'
import { ChatConversation } from './chat-conversation'
import type { AudioRefMeta, HermesUIMessage } from './types'

// Loads a thread's persisted transcript and hydrates the chat. `ChatConversation`
// reads `messages` only at init for a given id, so we must have the rows before
// mounting it — gate on the query, then mount keyed by thread id so switching
// threads remounts with the right history. See docs/HERMES-CHAT-PRD.md.

function toUIMessages(rows: HermesMessage[]): HermesUIMessage[] {
  return rows.map((row) => {
    const payload = row.payload as { audio?: AudioRefMeta[] } | null
    return {
      id: row.id,
      role: row.role,
      parts: (row.parts ?? []) as HermesUIMessage['parts'],
      metadata: {
        status: row.status,
        ...(payload?.audio?.length ? { audio: payload.audio } : {}),
      },
    }
  })
}

export function ChatView({
  thread,
  onBack,
  hideHeader,
}: {
  thread: HermesThread
  onBack?: () => void
  hideHeader?: boolean
}) {
  const { data, isLoading } = useQuery(hermesQueries.messages(thread.id))

  if (isLoading || !data) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    )
  }

  return (
    <ChatConversation
      key={thread.id}
      thread={thread}
      initialMessages={toUIMessages(data.data)}
      onBack={onBack}
      hideHeader={hideHeader}
    />
  )
}
