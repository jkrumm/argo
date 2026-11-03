import { Alert, Button, Group, Modal, Progress, Select, Stack, Text } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { refreshAfterWrite, useCurate, writeErrorMessage } from '../api/mutations'
import { useMeta } from '../api/queries'
import type { SetTagRequest, TxRow } from '../api/types'
import { TAX_TAGS, categoryGroups, tagLabel } from '../lib/categories'

export type BulkKind = 'category' | 'tag'

type BulkModalProps = {
  kind: BulkKind
  rows: readonly TxRow[]
  /** Whose bookings these are, when they share one (a merchant). */
  subject?: string
  onClose: () => void
  /** Called once when every write went through. */
  onDone: () => void
}

/**
 * Categorize or tag a selection: one write per booking, one after the other, with a progress bar.
 * The first failure stops the run and names itself; the bookings before it stay changed, the ones
 * after it are untouched, and the dialog says exactly how far it got.
 */
export function BulkModal({ kind, rows, subject, onClose, onDone }: BulkModalProps) {
  const meta = useMeta()
  const curate = useCurate()
  const queryClient = useQueryClient()
  const [value, setValue] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const noun = kind === 'category' ? 'category' : 'tax tag'
  const data =
    kind === 'category'
      ? categoryGroups(meta.data?.categories)
      : [
          { value: '', label: 'No tag (clear)' },
          ...TAX_TAGS.map((tag) => ({ value: tag, label: tagLabel(tag) })),
        ]

  async function run() {
    if (value === null) return
    setRunning(true)
    setFailure(null)
    setDone(0)
    let written = 0
    try {
      for (const row of rows) {
        if (kind === 'category') await curate.setCategory(row, value, false)
        else
          await curate.setTag(row, value === '' ? null : (value as SetTagRequest['tag']), {
            refresh: false,
          })
        written += 1
        setDone(written)
      }
    } catch (error) {
      setFailure(
        `${writeErrorMessage(error)} Stopped after ${written} of ${rows.length}; the rest are unchanged.`,
      )
      refreshAfterWrite(queryClient, 0)
      setRunning(false)
      return
    }
    refreshAfterWrite(queryClient, 0)
    setRunning(false)
    onDone()
  }

  return (
    <Modal
      opened
      onClose={running ? () => undefined : onClose}
      title={`Set ${noun} for ${rows.length} ${rows.length === 1 ? 'booking' : 'bookings'}${subject === undefined ? '' : ` of ${subject}`}`}
      centered
    >
      <Stack gap="sm">
        <Select
          label={kind === 'category' ? 'Category' : 'Tax tag'}
          placeholder={`Choose a ${noun}`}
          data={data}
          value={value}
          onChange={setValue}
          searchable={kind === 'category'}
          allowDeselect={false}
          disabled={running}
          data-autofocus
        />
        {(running || done > 0) && (
          <Stack gap="xs">
            <Progress value={(done / rows.length) * 100} aria-label="Bookings saved" />
            <Text size="xs" c="dimmed">
              {done} of {rows.length} saved
            </Text>
          </Stack>
        )}
        {failure !== null && (
          <Alert color="red" title="Not everything was saved">
            {failure}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={running}>
            {failure === null ? 'Cancel' : 'Close'}
          </Button>
          <Button onClick={() => void run()} loading={running} disabled={value === null}>
            Apply
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
