import { EmptyState } from 'basalt-ui'

export function NoDataState() {
  return (
    <EmptyState
      tier="page"
      title="No bookings yet"
      description="Import statements with `fin import ing`, then restart `fin ui`."
    />
  )
}
