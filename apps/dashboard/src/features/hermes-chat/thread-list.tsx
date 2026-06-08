import { formatDistanceToNowStrict } from 'date-fns'
import { Box, Button, Group, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconPencilPlus, IconPin } from '@tabler/icons-react'
import type { HermesThread } from '../../lib/queries/hermes'
import classes from './thread-list.module.css'

// Thread list pane: "new chat" + the threads, pinned-first/newest. Selection is
// UI state, not a data signal, so the selected row carries a neutral fill, never
// the identity blue (DESIGN.md). See docs/HERMES-CHAT-PRD.md.

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: HermesThread
  selected: boolean
  onSelect: () => void
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      className={classes.row}
      data-selected={selected || undefined}
    >
      <Group gap={6} wrap="nowrap" justify="space-between">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {thread.pinned > 0 && <IconPin size={13} className={classes.pin} />}
          <Text size="sm" fw={selected ? 'semibold' : 'normal'} lineClamp={1}>
            {thread.title ?? 'New chat'}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {formatDistanceToNowStrict(new Date(thread.updated_at), { addSuffix: false })}
        </Text>
      </Group>
    </UnstyledButton>
  )
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  onNewChat,
  creating,
}: {
  threads: HermesThread[]
  selectedId: string | null
  onSelect: (thread: HermesThread) => void
  onNewChat: () => void
  creating: boolean
}) {
  return (
    <Stack h="100%" gap={0}>
      <Box p="sm">
        <Button
          fullWidth
          variant="light"
          leftSection={<IconPencilPlus size={16} />}
          onClick={onNewChat}
          loading={creating}
        >
          New chat
        </Button>
      </Box>
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap={2} px="xs" pb="xs">
          {threads.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="lg">
              No threads yet.
            </Text>
          ) : (
            threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedId}
                onSelect={() => onSelect(thread)}
              />
            ))
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  )
}
