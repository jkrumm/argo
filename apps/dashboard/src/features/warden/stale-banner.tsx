import { Alert, Code } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import type { WardenSnapshotRecord } from '../../lib/queries/warden'

type Props = {
  snapshot: WardenSnapshotRecord | null
}

/**
 * Renders only when nothing has been pushed at all. A snapshot older than 30 minutes is the
 * summary sentence's `Loop stalled — snapshot <age> old` variant (`deriveSummary`), not a banner.
 */
export function StaleBanner({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <Alert
        data-shot="no-snapshot"
        data-shot-states="empty"
        color="gray"
        variant="light"
        icon={<IconInfoCircle size={16} />}
        title="No snapshot yet"
      >
        Warden pushes to <Code>POST /warden/snapshot</Code> after every loop tick, about every
        10&nbsp;min. If this stays empty, check that the Warden loop is running on the mini.
      </Alert>
    )
  }
  return null
}
