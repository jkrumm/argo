import { useState } from 'react'
import { Badge, Box, Button, Text, UnstyledButton } from '@mantine/core'
import { overlays } from 'basalt-ui/commands'
import { relativeTime } from '../../lib/format'
import {
  TYPE_LABEL,
  listTime,
  oldestUpdatedAt,
  untitledLabel,
  type ThreadEntry,
  type ThreadGroup,
} from './thread-list-model'
import classes from './thread-list.module.css'

export function TypeChip({ type }: { type: ThreadEntry['type'] }) {
  if (type === null) return null
  return (
    <Badge size="xs" variant="outline" color="gray" radius="sm" className={classes['chip']}>
      {TYPE_LABEL[type]}
    </Badge>
  )
}

function LiveDot() {
  return (
    <Box className={`${classes['dot']} ${classes['pulse']}`} role="img" aria-label="Generating" />
  )
}

function Row({
  entry,
  now,
  label,
  onOpen,
}: {
  entry: ThreadEntry
  now: number
  label: string
  onOpen: (id: string) => void
}) {
  return (
    <UnstyledButton className={classes['row']} onClick={() => onOpen(entry.id)}>
      <Box className={classes['rowGrid']}>
        <TypeChip type={entry.type} />
        <Box className={classes['body']}>
          <Text className={classes['title']}>{label}</Text>
          {entry.summary !== null && <Text className={classes['summary']}>{entry.summary}</Text>}
        </Box>
        <Text component="span" className={classes['time']}>
          {entry.streaming && <LiveDot />}
          {listTime(entry.updatedAt, now)}
        </Text>
      </Box>
    </UnstyledButton>
  )
}

/** A local chat the server has not titled yet reads as its first line, never as "New chat". */
function titleOf(entry: ThreadEntry): string {
  return entry.title ?? entry.summary ?? 'Untitled'
}

export function ThreadList({
  groups,
  untitled,
  now,
  busy,
  onOpen,
  onDeleteUntitled,
}: {
  groups: readonly ThreadGroup[]
  untitled: readonly ThreadEntry[]
  now: number
  busy: boolean
  onOpen: (id: string) => void
  onDeleteUntitled: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)

  function confirmDelete() {
    void overlays.confirm({
      title: 'Delete untitled chats',
      body: (
        <Text size="sm">
          Delete {untitled.length} untitled {untitled.length === 1 ? 'chat' : 'chats'} and their
          messages? This cannot be undone.
        </Text>
      ),
      confirmLabel: 'Delete all',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: () => onDeleteUntitled(untitled.map((entry) => entry.id)),
    })
  }

  return (
    <Box className={classes['root']}>
      {groups.map((group) => (
        <Box
          key={group.key}
          component="section"
          className={classes['group']}
          aria-label={group.label}
        >
          <Text className={classes['heading']}>
            {group.label} · {group.rows.length}
            {group.live && (
              <Text component="span" className={classes['live']}>
                <LiveDot />
                Live
              </Text>
            )}
          </Text>
          {group.rows.map((entry) => (
            <Row key={entry.id} entry={entry} now={now} label={titleOf(entry)} onOpen={onOpen} />
          ))}
        </Box>
      ))}

      {untitled.length > 0 && (
        <Box component="section" aria-label="Untitled chats">
          <Box className={classes['fold']}>
            <UnstyledButton
              className={classes['foldToggle']}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {untitledLabel(untitled.length, relativeTime(oldestUpdatedAt(untitled)))}
            </UnstyledButton>
            <Button
              variant="subtle"
              color="red"
              size="compact-xs"
              loading={busy}
              onClick={confirmDelete}
            >
              Delete all
            </Button>
          </Box>
          {open &&
            untitled.map((entry) => (
              <Box key={entry.id} className={classes['untitledRow']}>
                <UnstyledButton className={classes['row']} onClick={() => onOpen(entry.id)}>
                  <Text component="span" className={classes['summary']}>
                    Untitled
                  </Text>
                  <Text component="span" className={classes['time']} ml="sm">
                    {listTime(entry.updatedAt, now)}
                  </Text>
                </UnstyledButton>
              </Box>
            ))}
        </Box>
      )}
    </Box>
  )
}
