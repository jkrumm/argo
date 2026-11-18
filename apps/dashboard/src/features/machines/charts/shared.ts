import { alpha, VX } from 'basalt-ui/tokens'
import type { MachineDetail } from '../../../lib/queries/machines'
import { gapZones } from '../model'

/** One cursor across every chart of the page: hovering a moment in one reads the same moment in all. */
const MACHINES_CURSOR = 'machines-time'

/** The time axis every chart shares: the same extent, so a silent stretch lines up on all of them. */
export function timeAxis(range: { from: number; to: number } | undefined) {
  return {
    ...(range && { xDomain: [new Date(range.from * 1000), new Date(range.to * 1000)] as const }),
    xTicks: 5,
    cursorGroup: MACHINES_CURSOR,
  }
}

/** Silent stretches as faint red bands on the shared axis: the one attention colour besides a threshold. */
export function silentBands(detail: MachineDetail | undefined) {
  if (detail === undefined) return []
  return gapZones(detail.gaps, detail.from, detail.to, alpha(VX.status.bad, 0.25))
}
