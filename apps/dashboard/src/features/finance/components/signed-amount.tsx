import { Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { signedEur } from '../lib/format'

/** A signed amount in its status ink: a cost is bad, a gain good, zero plain. */
export function SignedAmount({ cents }: { cents: number }) {
  const color = cents === 0 ? VX.ink : cents < 0 ? VX.status.bad : VX.status.good
  return (
    <Text span c={color}>
      {signedEur(cents)}
    </Text>
  )
}
