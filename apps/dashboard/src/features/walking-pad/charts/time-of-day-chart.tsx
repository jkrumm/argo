import { type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w7): TimeOfDayChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 7) replaces this body.
export function TimeOfDayChart(_props: {
  params: WalkingPadWindowParams
  matchHeight?: number | undefined
}) {
  return <ChartCard title="Time of day" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
