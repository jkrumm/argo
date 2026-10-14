import { type WeightLogWindowParams } from '../../../lib/queries/weight-log'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w8): WeightChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 8) replaces this body.
export default function WeightChart(_props: { params: WeightLogWindowParams }) {
  return <ChartCard title="Body Weight" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
