import { Button } from '@mantine/core'

/** The step on a failed surface: refetches what failed; `loading` while those reads are in flight. */
export function RetryButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void
  loading: boolean
  /** Accessible name: what is retried (`Retry calendar sources`, `Retry tasks`). */
  label: string
}) {
  return (
    <Button
      variant="subtle"
      color="gray"
      size="compact-sm"
      loading={loading}
      aria-label={label}
      onClick={onClick}
    >
      Retry
    </Button>
  )
}
