import { Alert, Code, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import type { WardenSnapshotRecord } from '../../lib/queries/warden'
import { isStale } from './model'

type Props = {
  snapshot: WardenSnapshotRecord | null
}

/**
 * Renders only when the feed itself is suspect: nothing pushed at all, or the latest snapshot older
 * than 30 minutes. Warden pushes on a fixed ~10-minute loop cadence regardless of what it finds, so
 * age is a statement about the loop, not about the items on the board.
 */
export function StaleBanner({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <Alert
        color="gray"
        variant="light"
        icon={<IconInfoCircle size={16} />}
        title="No snapshot yet"
      >
        Nothing has been pushed to <Code>POST /warden/snapshot</Code> — the mini's loop has not
        reported.
      </Alert>
    )
  }
  if (!isStale(snapshot.receivedAt)) return null
  return (
    <Alert
      color="orange"
      variant="light"
      icon={<IconAlertTriangle size={16} />}
      title="Stale snapshot"
    >
      Latest snapshot from{' '}
      <Text span fw={600}>
        {snapshot.machine}
      </Text>{' '}
      was received {relativeTime(snapshot.receivedAt)} — the loop has stopped pushing. Everything
      below is that last snapshot, not the live state.
    </Alert>
  )
}
