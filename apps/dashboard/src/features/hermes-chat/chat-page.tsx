import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Box, Button, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { IconPencilPlus } from '@tabler/icons-react'
import { hermesMutations, hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { ThreadFeedRow } from './thread-feed-row'

// Single-column Slack-style thread feed. Each row shows badge + title + summary +
// timestamp + chevron; expanding it reveals the conversation inline. "New chat"
// creates a thread and auto-opens it. See docs/HERMES-CHAT-PRD.md + ChatWireframe.svg.

const FILL_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0rem) - var(--app-shell-footer-offset, 0rem) - var(--app-shell-padding) * 2)'

export function HermesChatPage() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data } = useSuspenseQuery(hermesQueries.threads('active'))
  const threads = data.data

  const create = useMutation({
    ...hermesMutations.createThread(),
    onSuccess: (thread: HermesThread) => {
      queryClient.setQueryData(hermesQueries.threads('active').queryKey, (old) =>
        old ? { data: [thread, ...old.data], total: old.total + 1 } : { data: [thread], total: 1 },
      )
      setExpandedId(thread.id)
    },
  })

  function newChat() {
    if (create.isPending) return
    create.mutate({})
  }

  function toggleThread(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <Stack h={FILL_HEIGHT} gap={0}>
      <Box
        px="sm"
        py={8}
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        <Group justify="space-between" align="center">
          <Text fw="semibold" size="sm">
            Hermes
          </Text>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPencilPlus size={14} />}
            onClick={newChat}
            loading={create.isPending}
          >
            New chat
          </Button>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} type="auto">
        {threads.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="xl">
            No threads yet. Start a new chat.
          </Text>
        ) : (
          threads.map((thread) => (
            <ThreadFeedRow
              key={thread.id}
              thread={thread}
              expanded={thread.id === expandedId}
              onToggle={() => toggleThread(thread.id)}
            />
          ))
        )}
      </ScrollArea>
    </Stack>
  )
}
