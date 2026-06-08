import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Card, Center, Group, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { hermesMutations, hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { ThreadList } from './thread-list'
import { ChatView } from './chat-view'

// Responsive list+detail chat surface. Mac (≥ md): two panes side by side.
// iPhone (< md): the thread list, then the open thread full-screen with a back
// affordance. Fills the app-shell main area exactly so the panes scroll
// internally rather than the page. See docs/HERMES-CHAT-PRD.md.

const FILL_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0rem) - var(--app-shell-footer-offset, 0rem) - var(--app-shell-padding) * 2)'

function EmptyDetail() {
  return (
    <Center h="100%" p="lg">
      <Text c="dimmed" size="sm" ta="center">
        Pick a thread on the left, or start a new chat.
      </Text>
    </Center>
  )
}

export function HermesChatPage() {
  const queryClient = useQueryClient()
  const isDesktop = useMediaQuery('(min-width: 62em)', false, { getInitialValueInEffect: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data } = useSuspenseQuery(hermesQueries.threads('active'))
  const threads = data.data
  const selected = threads.find((t) => t.id === selectedId) ?? null

  const create = useMutation({
    ...hermesMutations.createThread(),
    onSuccess: (thread: HermesThread) => {
      // Optimistically prepend so the new thread resolves immediately, then select it.
      queryClient.setQueryData(hermesQueries.threads('active').queryKey, (old) =>
        old ? { data: [thread, ...old.data], total: old.total + 1 } : { data: [thread], total: 1 },
      )
      setSelectedId(thread.id)
    },
  })

  function newChat() {
    if (create.isPending) return
    create.mutate({})
  }

  const list = (
    <ThreadList
      threads={threads}
      selectedId={selectedId}
      onSelect={(t) => setSelectedId(t.id)}
      onNewChat={newChat}
      creating={create.isPending}
    />
  )

  if (!isDesktop) {
    // Mobile: full-screen stack — list or the open thread (with back).
    return (
      <Card withBorder p={0} h={FILL_HEIGHT} style={{ overflow: 'hidden' }}>
        {selected ? <ChatView thread={selected} onBack={() => setSelectedId(null)} /> : list}
      </Card>
    )
  }

  // Desktop: two panes.
  return (
    <Group h={FILL_HEIGHT} gap={0} wrap="nowrap" align="stretch">
      <Card
        withBorder
        p={0}
        w={300}
        style={{ flexShrink: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        {list}
      </Card>
      <Card
        withBorder
        p={0}
        style={{
          flex: 1,
          minWidth: 0,
          borderLeft: 'none',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
        }}
      >
        <Stack h="100%" gap={0}>
          {selected ? <ChatView thread={selected} /> : <EmptyDetail />}
        </Stack>
      </Card>
    </Group>
  )
}
