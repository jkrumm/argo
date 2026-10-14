import { type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w7): LatencyP95 is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 7) replaces this body.
export default function LatencyP95(_props: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
}) {
  return <ChartCard title="p95 latency" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
