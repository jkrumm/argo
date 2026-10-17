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
  return null
}
