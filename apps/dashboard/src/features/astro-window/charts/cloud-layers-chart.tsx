import type { HourlyPoint } from '../types'
import { ChartCard } from 'basalt-ui/charts'

// MIGRATION-STUB(w9): CloudLayersChart is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function CloudLayersChart(_props: { hourly: HourlyPoint[] }) {
  return <ChartCard title="Cloud Layers" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
