import type { MeterProps, MeterZone } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import {
  RECOVERY_CUTOFF_CAPTION,
  RECOVERY_PUSH_FROM,
  RECOVERY_REST_BELOW,
  RECOVERY_VERDICT_NAME,
  recoveryVerdict,
} from './model'

const ZONES: MeterZone[] = [
  { from: 0, to: RECOVERY_REST_BELOW, label: RECOVERY_VERDICT_NAME.rest, color: VX.bad },
  {
    from: RECOVERY_REST_BELOW,
    to: RECOVERY_PUSH_FROM,
    label: RECOVERY_VERDICT_NAME.normal,
    color: VX.warn,
  },
  { from: RECOVERY_PUSH_FROM, to: 100, label: RECOVERY_VERDICT_NAME.push, color: VX.good },
]

/**
 * The recovery meter, once: zones, cut-off caption and a label that names the verdict. Home's tile
 * and Garmin's cell spread this, so the same day's score reads the same on both pages.
 */
export function recoveryMeterProps(
  score: number | null,
): Required<Pick<MeterProps, 'label' | 'min' | 'max' | 'zones' | 'startCaption' | 'endCaption'>> {
  return {
    label:
      score === null
        ? 'Recovery score'
        : `Recovery score, ${RECOVERY_VERDICT_NAME[recoveryVerdict(score)]} zone`,
    min: 0,
    max: 100,
    zones: ZONES,
    startCaption: RECOVERY_CUTOFF_CAPTION,
    endCaption: '100',
  }
}
