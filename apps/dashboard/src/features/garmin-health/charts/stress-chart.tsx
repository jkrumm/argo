import { ChartCard } from 'basalt-ui/charts'
import type { SummaryParams } from '../types'

// MIGRATION-STUB(w8): StressChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 8) replaces this body.
export default function StressChart(_props: { params: SummaryParams }) {
  return <ChartCard title="Stress Levels" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
