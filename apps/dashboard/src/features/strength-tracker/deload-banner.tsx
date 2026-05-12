import { useQuery } from '@tanstack/react-query'
import { Alert } from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import { strengthQueries } from '../../lib/queries/strength'

/**
 * Renders a Mantine Alert when the deload signal indicates `monitor` or
 * `deload`. Silent while loading or when the verdict is `progress`.
 *
 * Uses `useQuery` (not suspense) so the banner is optional — it never blocks
 * the page render.
 */
export function DeloadBanner({ exercises }: { exercises?: string }) {
  const { data } = useQuery(strengthQueries.deloadSignal({ exercises }))
  if (!data || data.verdict === 'progress') return null

  const isDeload = data.verdict === 'deload'
  const title = isDeload ? 'Deload recommended' : 'Monitor'
  const body = data.activeSignals.length > 0 ? data.activeSignals.join(' · ') : 'See trends below'

  return (
    <Alert
      color={isDeload ? 'red' : 'yellow'}
      icon={isDeload ? <IconAlertTriangle size={16} /> : <IconInfoCircle size={16} />}
      title={title}
      variant="light"
    >
      {body}
    </Alert>
  )
}
