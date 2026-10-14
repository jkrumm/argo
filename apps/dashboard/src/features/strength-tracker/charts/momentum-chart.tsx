import { type StrengthQueryParams } from '../../../lib/queries/strength'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): MomentumChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function MomentumChart(_props: { params: StrengthQueryParams }) {
  return <ChartCard title="Momentum" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
