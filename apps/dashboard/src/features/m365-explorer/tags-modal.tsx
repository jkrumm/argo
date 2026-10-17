import { ActionIcon, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { m365Mutations, m365Queries } from '../../lib/queries/m365'
import { plural } from './model'
import classes from './m365.module.css'

export function TagsModal(props: {
  opened: boolean
  onClose: () => void
  tagCounts: Array<[string, number]>
}) {
  const qc = useQueryClient()
  const renameTag = useMutation({
    ...m365Mutations.renameTag(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: m365Queries.all() })
    },
  })
  const deleteTag = useMutation({
    ...m365Mutations.deleteTag(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: m365Queries.all() })
    },
  })

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="Manage tags" size="md">
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          Rename a tag to update every source carrying it. Deleting a tag removes the label from
          every source — the chats/channels themselves are not touched.
        </Text>
        {props.tagCounts.length === 0 ? (
          <Text c="dimmed" size="sm">
            No tags yet.
          </Text>
        ) : (
          <Stack gap="xs">
            {props.tagCounts.map(([tag, count]) => (
              <TagRow
                key={tag}
                tag={tag}
                count={count}
                onRename={(to) => renameTag.mutate({ tag, to })}
                onDelete={() => deleteTag.mutate(tag)}
                renaming={renameTag.isPending}
                deleting={deleteTag.isPending}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  )
}

function TagRow(props: {
  tag: string
  count: number
  onRename: (to: string) => void
  onDelete: () => void
  renaming: boolean
  deleting: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.tag)
  return (
    <Group gap="xs" justify="space-between" wrap="nowrap">
      <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
        <span className={classes.chipStatic}>{props.tag}</span>
        <Text size="sm" c="dimmed">
          {plural(props.count, 'source')}
        </Text>
      </Group>
      {editing ? (
        <Group gap={4} wrap="nowrap">
          <TextInput
            size="xs"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim() && draft.trim() !== props.tag) {
                props.onRename(draft.trim())
                setEditing(false)
              }
              if (e.key === 'Escape') {
                setEditing(false)
                setDraft(props.tag)
              }
            }}
          />
          <Button
            size="xs"
            onClick={() => {
              if (draft.trim() && draft.trim() !== props.tag) props.onRename(draft.trim())
              setEditing(false)
            }}
            loading={props.renaming}
          >
            Save
          </Button>
        </Group>
      ) : (
        <Group gap={4} wrap="nowrap">
          <Button size="xs" variant="subtle" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <ActionIcon
            size="sm"
            color="red"
            variant="subtle"
            onClick={() => props.onDelete()}
            loading={props.deleting}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      )}
    </Group>
  )
}
