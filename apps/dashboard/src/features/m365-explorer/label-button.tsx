import { Button, CopyButton, Popover, Stack, Textarea, TextInput } from '@mantine/core'
import { IconCheck, IconChevronDown, IconCopy, IconStar, IconStarFilled } from '@tabler/icons-react'
import { useState } from 'react'
import classes from './m365.module.css'

export type LabelButtonProps = {
  existing: { label: string; notes: string | null } | null
  /** Known tags, most-used first. */
  tags: readonly string[]
  saving: boolean
  /** The record's `chat:<id>` / `channel:<team>:<id>` key, copyable from the panel. */
  sourceId: string
  onSave: (label: string, notes: string | null) => void
  onRemove: () => void
}

/**
 * The one primary action of a record: `Label as <tag>` applies the pending tag; the chevron opens a
 * panel with the tag list, a new-tag input, the notes and the source id. A Popover, not a Menu, so
 * the inputs keep their own keyboard handling. Drafts reset when the record or its stored label changes.
 */
export function LabelButton({
  existing,
  tags,
  saving,
  sourceId,
  onSave,
  onRemove,
}: LabelButtonProps) {
  const stored = existing?.label.trim() ?? ''
  const storedNotes = existing?.notes?.trim() ?? ''
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
    setOpened(false)
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
      <Popover opened={opened} onChange={setOpened} position="bottom-end" width={260} trapFocus>
        <Popover.Target>
          <Button px="xs" aria-label="Choose tag and notes" onClick={() => setOpened((o) => !o)}>
            <IconChevronDown size={14} />
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs">
            {tags.length > 0 ? (
              <div className={classes.tagPick} role="group" aria-label="Tags">
                {tags.map((t) => (
                  <Button
                    key={t}
                    size="compact-xs"
                    variant={t === trimmedTag ? 'light' : 'subtle'}
                    color="gray"
                    onClick={() => setTag(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            ) : null}
            <TextInput
              label="Tag"
              placeholder="new or existing tag"
              value={tag}
              onChange={(e) => setTag(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply()
              }}
            />
            <Textarea
              label="Notes"
              placeholder="optional, visible to agents"
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={5}
            />
            <CopyButton value={sourceId} timeout={1200}>
              {({ copied, copy }) => (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  onClick={copy}
                >
                  {copied ? 'Copied' : 'Copy source id'}
                </Button>
              )}
            </CopyButton>
            {existing ? (
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() => {
                  setOpened(false)
                  onRemove()
                }}
              >
                Remove label
              </Button>
            ) : null}
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Button.Group>
  )
}
