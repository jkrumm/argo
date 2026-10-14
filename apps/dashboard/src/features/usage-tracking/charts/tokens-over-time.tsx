import { type Grain, type Range } from '../../../lib/queries/usage'
import type { BillingValue, TokensGroupBy, WorkspaceValue } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w7): TokensOverTime is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 7) replaces this body.
export default function TokensOverTime(_props: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
  groupBy: TokensGroupBy
}) {
  return <ChartCard title="Tokens over time" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
