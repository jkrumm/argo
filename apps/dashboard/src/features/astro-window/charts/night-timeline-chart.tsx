import type { HourlyPoint, Night } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): NightTimelineChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function NightTimelineChart(_props: { hourly: HourlyPoint[]; night: Night }) {
  return <ChartCard title="Night Timeline" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
