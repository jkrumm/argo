import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { reportWriteError, useCurate } from '../api/mutations'
import type { Cadence, RecurringRow } from '../api/types'
import { eur, eurExact } from '../lib/format'
import { CADENCE_LABEL, isExcluded, seatLabel } from '../lib/recurring'
import { date } from 'basalt-ui/format'

const CADENCES: Cadence[] = ['monthly', 'quarterly', 'yearly']

/**
 * One recurring series, in detail, and the three ways to correct the detection: treat it as recurring
 * at a cadence, leave it out, or go back to what the detection says.
 */
export function RecurringModal({ row, onClose }: { row: RecurringRow; onClose: () => void }) {
  const curate = useCurate()
  const [busy, setBusy] = useState(false)

  async function set(mode: 'include' | 'exclude' | null, cadence?: Cadence) {
    setBusy(true)
    try {
      await curate.setOverride({ merchant: row.merchant, mode, ...(cadence && { cadence }) })
      onClose()
    } catch (error) {
      reportWriteError(error)
      setBusy(false)
    }
  }

  const seat = seatLabel(row)
  const facts: [string, string][] = [
    ['Latest charge', eurExact(-row.current_cents)],
    ['Average, last 12 months', eurExact(-row.avg_cents)],
    ['Range', `${eurExact(-row.min_cents)} to ${eurExact(-row.max_cents)}`],
    ['Charges', `${row.count} since ${date(row.first_on)}`],
    ['Last charged', date(row.last_on)],
    ['Next expected', row.next_expected_on === null ? 'Not expected' : date(row.next_expected_on)],
  ]
  const apart = [
    ...row.settlements.map((s) => ({ ...s, kind: 'Settlement' })),
    ...row.extras.map((s) => ({ ...s, kind: 'Extra' })),
  ].toSorted((a, b) => b.booked_on.localeCompare(a.booked_on))

  return (
    <Modal
      opened
      onClose={busy ? () => undefined : onClose}
      title={`${row.merchant}${seat === null ? '' : ` · ${seat}`}`}
      centered
    >
      <Stack gap="md">
        <Stack gap="xs">
          {facts.map(([label, value]) => (
            <Group key={label} justify="space-between" wrap="nowrap" gap="md">
              <Text size="sm" c="dimmed">
                {label}
              </Text>
              <Text size="sm">{value}</Text>
            </Group>
          ))}
        </Stack>
        {apart.length > 0 && (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              Charges kept out of every figure
            </Text>
            {apart.slice(0, 6).map((a) => (
              <Group key={`${a.kind}-${a.booked_on}`} justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {a.kind} · {date(a.booked_on)}
                </Text>
                <Text size="sm">{eur(-a.amount_cents)}</Text>
              </Group>
            ))}
          </Stack>
        )}
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {isExcluded(row)
              ? 'Left out of the list by hand.'
              : row.override?.mode === 'include'
                ? `Counted as recurring by hand, ${CADENCE_LABEL[row.cadence].toLowerCase()}.`
                : 'Found by the detection.'}
          </Text>
          <Group gap="xs">
            {CADENCES.map((c) => (
              <Button
                key={c}
                variant="default"
                disabled={busy}
                onClick={() => void set('include', c)}
              >
                Recurring {c === 'monthly' ? 'monthly' : c}
              </Button>
            ))}
          </Group>
          <Group gap="xs">
            <Button
              variant="default"
              color="red"
              disabled={busy || isExcluded(row)}
              onClick={() => void set('exclude')}
            >
              Not recurring
            </Button>
            <Button
              variant="default"
              disabled={busy || row.override === null}
              onClick={() => void set(null)}
            >
              Back to detection
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Modal>
  )
}
