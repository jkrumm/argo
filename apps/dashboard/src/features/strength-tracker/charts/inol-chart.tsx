import { type StrengthQueryParams } from '../../../lib/queries/strength'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): InolChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function InolChart(_props: { params: StrengthQueryParams }) {
  return (
    <ChartCard title="INOL — Session Quality" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
  )
}
