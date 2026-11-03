import { Stack } from '@mantine/core'
import { EmptyState } from 'basalt-ui'
import { FinanceBar } from './finance-bar'

/** An empty vault still gets the vault controls: syncing is how it fills. */
export function NoDataState() {
  return (
    <Stack gap="sm">
      <FinanceBar />
      <EmptyState
        tier="page"
        title="No bookings yet"
        description="Run a sync, or import statements with `fin import ing` on the MacBook."
      />
    </Stack>
  )
}
