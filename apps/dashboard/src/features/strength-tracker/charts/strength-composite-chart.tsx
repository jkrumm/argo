import { type StrengthQueryParams } from '../../../lib/queries/strength'
import { EXERCISE_KEYS } from '../../../lib/window-stores'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): StrengthCompositeChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function StrengthCompositeChart(_props: {
  params: StrengthQueryParams
  exerciseId: (typeof EXERCISE_KEYS)[number]
}) {
  return <ChartCard title="Strength Composite" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
