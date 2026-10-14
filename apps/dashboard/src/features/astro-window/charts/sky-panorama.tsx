import { ChartCard } from 'basalt-ui/charts'
import type { HourlyPoint, Site } from '../types'

// MIGRATION-STUB(w9): SkyPanorama is not ported to basalt-ui 2.0 yet; the signature is kept so
// callers compile, and the port (docs/waves/PLAN.md, Wave 9) replaces this body.
export default function SkyPanorama(_props: {
  site: Site
  detailDate: string
  hourly: HourlyPoint[]
  /** Moon illuminated fraction for this night, 0..1 — scales the moon marker. */
  moonIllumination: number
}) {
  return <ChartCard title="Sky Panorama" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
}
