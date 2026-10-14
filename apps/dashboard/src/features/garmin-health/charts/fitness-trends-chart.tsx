import type { SummaryParams } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w8): FitnessTrendsChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 8) replaces this body.
export default function FitnessTrendsChart(_props: { params: SummaryParams }) {
  return <ChartCard title="Fitness Trends" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
