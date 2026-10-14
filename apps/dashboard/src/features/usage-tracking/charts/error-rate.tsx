import { type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w7): ErrorRate is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 7) replaces this body.
export default function ErrorRate(_props: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
}) {
  return <ChartCard title="Errors over time" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
