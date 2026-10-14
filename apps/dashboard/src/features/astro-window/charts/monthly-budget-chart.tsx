import type { Site } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): MonthlyBudgetChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function MonthlyBudgetChart(_props: { site: Site }) {
  return (
    <ChartCard title="Annual Visibility Budget" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
  )
}
