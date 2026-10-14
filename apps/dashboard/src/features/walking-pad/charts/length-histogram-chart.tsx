import { type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w7): LengthHistogramChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 7) replaces this body.
export function LengthHistogramChart(_props: { params: WalkingPadWindowParams }) {
  return <ChartCard title="Session length" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
