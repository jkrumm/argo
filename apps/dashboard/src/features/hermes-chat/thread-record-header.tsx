import { ActionIcon, Box, Group, Menu, Text } from '@mantine/core'
import { IconArrowLeft, IconDots } from '@tabler/icons-react'
import { useSizeClass } from 'basalt-ui'
import { overlays } from 'basalt-ui/commands'
import { factsLine, type ThreadEntry } from './thread-list-model'
import { TypeChip } from './thread-list'
import classes from './thread-record-header.module.css'

/**
 * The thread's record header: title, type chip, one facts line, one overflow menu (pin, archive,
 * delete — the verbs `PATCH`/`DELETE /hermes/threads/:id` support). Recipe: SPEC §4 record page.
 */
export function ThreadRecordHeader({
  entry,
  now,
  busy,
  onBack,
  onPin,
  onArchive,
  onDelete,
}: {
  entry: ThreadEntry
  now: number
  busy: boolean
  onBack: () => void
  onPin: (pinned: boolean) => void
  onArchive: () => void
  onDelete: () => void
}) {
  const compact = useSizeClass() === 'compact'
  // Server-only verbs: a chat the server has no row for yet cannot be pinned, archived or deleted.
  const actionable = entry.persisted

  function confirmDelete() {
    void overlays.confirm({
      title: 'Delete thread',
      body: <Text size="sm">Delete this thread and its messages? This cannot be undone.</Text>,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: onDelete,
    })
  }

  return (
    <Box className={classes['root']} data-shot="thread-record-header">
      <Group gap="sm" wrap="nowrap" justify="space-between">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ActionIcon variant="subtle" color="gray" aria-label="Threads" onClick={onBack}>
            <IconArrowLeft size={16} />
          </ActionIcon>
          <Text className={classes['title']}>{entry.title ?? entry.summary ?? 'Untitled'}</Text>
          {!compact && <TypeChip type={entry.type} />}
        </Group>
        {actionable && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Thread actions" loading={busy}>
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => onPin(!entry.pinned)}>
                {entry.pinned ? 'Unpin' : 'Pin'}
              </Menu.Item>
              <Menu.Item onClick={onArchive}>Archive</Menu.Item>
              <Menu.Item color="red" onClick={confirmDelete}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Text className={classes['facts']}>{factsLine({ entry, now, compact })}</Text>
      {entry.summary !== null && (
        <Text size="sm" c="dimmed" lineClamp={3}>
          {entry.summary}
        </Text>
      )}
    </Box>
  )
}
