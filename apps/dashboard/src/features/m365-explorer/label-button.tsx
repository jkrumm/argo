import { Button, Menu, Textarea, TextInput } from '@mantine/core'
import { IconChevronDown, IconStar, IconStarFilled } from '@tabler/icons-react'
import { useState } from 'react'

export type LabelButtonProps = {
  existing: { label: string; notes: string | null } | null
  /** Known tags, most-used first. */
  tags: readonly string[]
  saving: boolean
  onSave: (label: string, notes: string | null) => void
  onRemove: () => void
}

/**
 * The one primary action of a record: `Label as <tag>` applies the pending tag; the chevron opens the
 * tag list, a new-tag input and the notes. Drafts reset when the record or its stored label changes.
 */
export function LabelButton({ existing, tags, saving, onSave, onRemove }: LabelButtonProps) {
  const stored = existing?.label ?? ''
  const storedNotes = existing?.notes ?? ''
  const key = `${stored}|${storedNotes}`
  const [lastKey, setLastKey] = useState(key)
  const [tag, setTag] = useState(stored || tags[0] || '')
  const [notes, setNotes] = useState(storedNotes)
  const [opened, setOpened] = useState(false)
  if (lastKey !== key) {
    setLastKey(key)
    setTag(stored || tags[0] || '')
    setNotes(storedNotes)
  }

  const trimmedTag = tag.trim()
  const trimmedNotes = notes.trim()
  const dirty = !existing || trimmedTag !== stored || trimmedNotes !== storedNotes
  const apply = (): void => {
    if (!trimmedTag) {
      setOpened(true)
      return
    }
    onSave(trimmedTag, trimmedNotes || null)
  }

  return (
    <Button.Group data-shot="label-button">
      <Button
        leftSection={dirty ? <IconStar size={14} /> : <IconStarFilled size={14} />}
        onClick={apply}
        loading={saving}
        disabled={!dirty}
      >
        {dirty ? (trimmedTag ? `Label as ${trimmedTag}` : 'Label as…') : `Labeled · ${stored}`}
      </Button>
      <Menu opened={opened} onChange={setOpened} position="bottom-end" width={260}>
        <Menu.Target>
          <Button px="xs" aria-label="Choose tag and notes">
            <IconChevronDown size={14} />
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {tags.length > 0 ? <Menu.Label>Tags</Menu.Label> : null}
          {tags.map((t) => (
            <Menu.Item key={t} onClick={() => setTag(t)} fw={t === trimmedTag ? 600 : undefined}>
              {t}
            </Menu.Item>
          ))}
          <Menu.Label>New tag</Menu.Label>
          <TextInput
            mx="xs"
            placeholder="tag"
            value={tag}
            onChange={(e) => setTag(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setOpened(false)
                apply()
              }
            }}
          />
          <Menu.Label>Notes</Menu.Label>
          <Textarea
            mx="xs"
            mb="xs"
            placeholder="optional, visible to agents"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={5}
          />
          {existing ? (
            <>
              <Menu.Divider />
              <Menu.Item color="red" onClick={onRemove}>
                Remove label
              </Menu.Item>
            </>
          ) : null}
        </Menu.Dropdown>
      </Menu>
    </Button.Group>
  )
}
