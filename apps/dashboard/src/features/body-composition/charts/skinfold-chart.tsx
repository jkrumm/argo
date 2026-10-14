import { type SkinfoldWindowParams } from '../../../lib/queries/skinfold-log'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w8): SkinfoldChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 8) replaces this body.
export default function SkinfoldChart(_props: { params: SkinfoldWindowParams }) {
  return <ChartCard title="Skinfold / Belly Fat" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
