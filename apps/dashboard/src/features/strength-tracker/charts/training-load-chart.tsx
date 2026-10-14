import { type StrengthQueryParams } from '../../../lib/queries/strength'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): TrainingLoadChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function TrainingLoadChart(_props: { params: StrengthQueryParams }) {
  return <ChartCard title="Training Load (ACWR)" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
