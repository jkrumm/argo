import { withUnit } from '../../lib/format'
import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import type { ReactNode } from 'react'
import type { WardenBudget, WardenHealth, WardenMetrics } from '../../lib/queries/warden'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import {
  BUDGET_MISSING,
  REVERTS_INFO,
  deriveBudgetFooter,
  deriveStrip,
  fixesLegend,
  formatNumber,
  pollerFooter,
  revertsFooter,
  verdictsFooter,
  type BudgetMeter,
  type StripModel,
} from './page-model'

type Props = {
  metrics: WardenMetrics | undefined
  health: WardenHealth | undefined
  budget: WardenBudget | undefined
}

/** The decision-wait meter runs 0–24 h with the 24 h mark ticked: past it the wait reads as a verdict. */
const WAIT_TICK_H = 24
/** The budget track runs this far past the cap so the cap tick sits inside the track. */
const BUDGET_TRACK_OVERSHOOT = 1.25

type VerdictTone = 'warn' | 'bad' | undefined

/** One tone drives both the cell value ink and the Meter fill, so the two cannot drift. */
const toneCell = (tone: VerdictTone) => (tone === undefined ? {} : { tone })
const toneMeter = (tone: VerdictTone) => (tone === undefined ? {} : { color: VX.status[tone] })

const noData = (reason: string) => `no data: ${reason}`

function verdictsCell({ verdicts }: StripModel): StatStripCell {
  const { pct, unavailable } = verdicts
  if (pct === null) {
    return {
      key: 'verdicts',
      caption: 'Verdicts recorded',
      value: null,
      footer: noData(unavailable ?? 'not reported'),
    }
  }
  return {
    key: 'verdicts',
    caption: 'Verdicts recorded',
    info: 'Items warden has recorded a verdict for, out of every item it tracks, since history began.',
    value: String(Math.round(pct)),
    unit: '%',
    footer: verdictsFooter(verdicts),
  }
}

function fixesCell({ fixes }: StripModel): StatStripCell {
  const caption = 'Fixes vs silence'
  if (fixes.pct === null) {
    return {
      key: 'fixes',
      caption,
      value: null,
      footer: noData(fixes.unavailable ?? 'not reported'),
    }
  }
  // The bar plots what the headline measures (fixed against quiet); closed items stay in the qualifier.
  const parts = [
    { label: 'fixed', value: fixes.fixed, color: VX.status.good },
    { label: 'quiet', value: fixes.quiet, color: VX.status.warn },
  ]
  const present = parts.filter((part) => part.value !== null)
  const total = present.reduce((sum, part) => sum + (part.value ?? 0), 0)
  return {
    key: 'fixes',
    caption,
    info: 'Fixed as a share of fixed plus quiet items. Closed items are counted in the legend only.',
    value: String(Math.round(fixes.pct)),
    unit: '%',
    footer: (
      <>
        all time
        <br />
        {fixesLegend(fixes)}
      </>
    ),
    visual: (
      <Meter
        label="Fixes versus silence, all time"
        max={Math.max(total, 1)}
        segments={present.map((part) => ({
          value: part.value ?? 0,
          label: part.label,
          color: part.color,
        }))}
      />
    ),
  }
}

function waitCell({ wait }: StripModel): StatStripCell {
  const caption = 'Decision wait'
  if (wait.hours === null) {
    return {
      key: 'wait',
      caption,
      value: null,
      footer: noData(wait.unavailable ?? 'not reported'),
    }
  }
  const tone: VerdictTone = wait.hours > WAIT_TICK_H ? 'warn' : undefined
  return {
    key: 'wait',
    caption,
    info: 'Median time from needs-decision to the owner’s decision, over the window.',
    value: formatNumber(wait.hours),
    unit: 'h',
    ...toneCell(tone),
    footer: `${withUnit(wait.windowDays, 'd')} median${wait.pairs === null ? '' : ` · ${wait.pairs} pairs`}`,
    visual: (
      <Meter
        label="Median decision wait against 24 hours"
        value={wait.hours}
        max={WAIT_TICK_H}
        ticks={[{ at: WAIT_TICK_H, label: `${withUnit(WAIT_TICK_H, 'h')}` }]}
        {...toneMeter(tone)}
        startCaption={null}
        endCaption={null}
      />
    ),
  }
}

function unattendedCell({ unattended }: StripModel): StatStripCell {
  const caption = 'Unattended fixes'
  if (unattended.fixes === null) {
    return {
      key: 'unattended',
      caption,
      value: null,
      footer: noData(unattended.unavailable ?? 'not reported'),
    }
  }
  return {
    key: 'unattended',
    caption,
    info: 'Fixes verified without owner input in the window.',
    value: formatNumber(unattended.fixes),
    unit: unattended.fixes === 1 ? 'fix' : 'fixes',
    footer: `last ${withUnit(unattended.windowDays, 'd')}`,
  }
}

function pollerCell({ poller }: StripModel): StatStripCell {
  const caption = 'Oldest poller'
  if (poller.oldestMin === null) {
    return {
      key: 'poller',
      caption,
      value: null,
      footer: noData(poller.unavailable ?? 'not reported'),
    }
  }
  const limit = poller.thresholdMin
  const tone: VerdictTone = poller.stale ? 'bad' : undefined
  return {
    key: 'poller',
    caption,
    info: `Age of the least recently run poller; at ${withUnit(limit, 'min')} it counts as stale.`,
    value: formatNumber(poller.oldestMin),
    unit: 'min',
    ...toneCell(tone),
    footer: pollerFooter(poller),
    visual: (
      <Meter
        label={`Oldest poller age against ${limit} minutes`}
        value={poller.oldestMin}
        max={limit}
        ticks={[{ at: limit, label: `${withUnit(limit, 'min')}` }]}
        {...toneMeter(tone)}
        startCaption={null}
        endCaption={null}
      />
    ),
  }
}

function revertsCell({ reverts }: StripModel): StatStripCell {
  const caption = 'Reverts · reopens'
  return {
    key: 'reverts',
    caption,
    value: reverts.reverts === null ? null : String(reverts.reverts),
    unit: reverts.reverts === 1 ? 'revert' : 'reverts',
    ...(reverts.reverts !== null && reverts.reverts > 0 && { tone: 'bad' as const }),
    info: REVERTS_INFO,
    footer: revertsFooter(reverts, noData),
  }
}

function BudgetMeterRow({ meter }: { meter: BudgetMeter }) {
  const caption: ReactNode = (
    <Text size="xs" c="dimmed" ff="monospace" tt="uppercase">
      {meter.caption}
    </Text>
  )
  if (meter.used === null || meter.max === null) {
    return (
      <Stack gap={4}>
        {caption}
        <Text fz="xl" fw={600} lh={1.1}>
          —
        </Text>
        <Text size="xs" c="dimmed">
          {BUDGET_MISSING.one(meter.name)}
        </Text>
      </Stack>
    )
  }
  return (
    <Stack gap={4}>
      {caption}
      <Meter
        label={meter.caption}
        value={meter.used}
        max={Math.max(meter.max * BUDGET_TRACK_OVERSHOOT, 1)}
        target={meter.max}
        {...(meter.warn ? { color: VX.status.warn } : {})}
        startCaption={`${meter.used} / ${meter.max} today`}
        endCaption={`max ${meter.max}`}
      />
    </Stack>
  )
}

/** The six-cell health strip with the two budget meters as its footer row. Numbers always carry a
 * unit; a null metric is `—` plus `no data: <reason>`, never 0. */
export function HealthStrip({ metrics, health, budget }: Props) {
  const model = deriveStrip(metrics, health)
  const cells = [
    verdictsCell(model),
    fixesCell(model),
    waitCell(model),
    unattendedCell(model),
    pollerCell(model),
    revertsCell(model),
  ]
  const budgetFooter = deriveBudgetFooter(budget)
  const footer =
    budgetFooter.kind === 'not-reported'
      ? [
          {
            key: 'budget',
            content: (
              <Text size="xs" c="dimmed">
                {BUDGET_MISSING.both}
              </Text>
            ),
          },
        ]
      : budgetFooter.meters.map((meter) => ({
          key: meter.key,
          content: <BudgetMeterRow meter={meter} />,
        }))
  return (
    <StatGroup
      variant="strip"
      label="Warden health"
      cols={6}
      cells={cells}
      footer={footer}
      shotAbsent={['empty']}
    />
  )
}
