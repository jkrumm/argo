import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import type { ReactNode } from 'react'
import type { WardenBudget, WardenHealth, WardenMetrics } from '../../lib/queries/warden'
import { Meter } from 'basalt-ui'
import { StatStrip, type StatStripCell } from './stat-strip'
import {
  POLLER_SCALE_MIN,
  deriveBudget,
  deriveStrip,
  formatNumber,
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

const noData = (reason: string) => `no data: ${reason}`

function verdictsCell({ verdicts }: StripModel): StatStripCell {
  const { pct, numerator, denominator, unavailable } = verdicts
  if (pct === null) {
    return {
      key: 'verdicts',
      caption: 'Verdicts recorded',
      value: '—',
      qualifier: noData(unavailable ?? 'not reported'),
    }
  }
  return {
    key: 'verdicts',
    caption: 'Verdicts recorded',
    info: 'Items warden has recorded a verdict for, out of every item it tracks, since history began.',
    value: String(Math.round(pct)),
    unit: '%',
    qualifier: 'all time',
    visual: (
      <Meter
        label="Verdicts recorded, all time"
        value={pct}
        max={100}
        startCaption={
          numerator !== null && denominator !== null ? `${numerator} of ${denominator} items` : null
        }
        endCaption={null}
      />
    ),
  }
}

function fixesCell({ fixes }: StripModel): StatStripCell {
  const caption = 'Fixes vs silence'
  if (fixes.pct === null) {
    return {
      key: 'fixes',
      caption,
      value: '—',
      qualifier: noData(fixes.unavailable ?? 'not reported'),
    }
  }
  const parts = [
    { label: 'fixed', value: fixes.fixed, color: VX.status.good },
    { label: 'quiet', value: fixes.quiet, color: VX.status.warn },
    { label: 'closed', value: fixes.closed, color: VX.status.neutral },
  ] as const
  const present = parts.filter((part) => part.value !== null)
  const total = present.reduce((sum, part) => sum + (part.value ?? 0), 0)
  return {
    key: 'fixes',
    caption,
    info: 'Fixed as a share of fixed plus quiet items. Closed items are drawn in the bar but not counted in the percentage.',
    value: String(Math.round(fixes.pct)),
    unit: '%',
    qualifier: (
      <>
        all time · share of fixed + quiet
        <br />
        <Text span size="xs" c={VX.status.good}>
          fixed {fixes.fixed ?? '—'}
        </Text>
        {' · '}
        <Text span size="xs" c={VX.status.warn}>
          quiet {fixes.quiet ?? '—'}
        </Text>
        {' · closed '}
        {fixes.closed ?? '—'}
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
        startCaption={null}
        endCaption={null}
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
      value: '—',
      qualifier: noData(wait.unavailable ?? 'not reported'),
    }
  }
  const over = wait.hours > WAIT_TICK_H
  return {
    key: 'wait',
    caption,
    info: 'Median time from needs-decision to the owner’s decision, over the window.',
    value: formatNumber(wait.hours),
    unit: 'h',
    valueColor: over ? VX.status.warn : undefined,
    qualifier: `${wait.windowDays} d median${wait.pairs === null ? '' : ` · ${wait.pairs} pairs`}`,
    visual: (
      <Meter
        label="Median decision wait against 24 hours"
        value={wait.hours}
        max={WAIT_TICK_H}
        target={WAIT_TICK_H}
        {...(over ? { color: VX.status.warn } : {})}
        startCaption={null}
        endCaption={`${WAIT_TICK_H} h`}
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
      value: '—',
      qualifier: noData(unattended.unavailable ?? 'not reported'),
    }
  }
  return {
    key: 'unattended',
    caption,
    info: 'Fixes verified without owner input in the window.',
    value: formatNumber(unattended.fixes),
    unit: unattended.fixes === 1 ? 'fix' : 'fixes',
    qualifier: `last ${unattended.windowDays} d · Δ — no prior window`,
  }
}

function pollerCell({ poller }: StripModel): StatStripCell {
  const caption = 'Oldest poller'
  if (poller.oldestMin === null) {
    return {
      key: 'poller',
      caption,
      value: '—',
      qualifier: noData(poller.unavailable ?? 'not reported'),
    }
  }
  return {
    key: 'poller',
    caption,
    info: 'Age of the least recently run poller; at 30 min it counts as stale.',
    value: formatNumber(poller.oldestMin),
    unit: 'min',
    valueColor: poller.oldestMin >= POLLER_SCALE_MIN ? VX.status.bad : undefined,
    qualifier: `stale at ${POLLER_SCALE_MIN} min`,
    visual: (
      <Meter
        label={`Oldest poller age against ${POLLER_SCALE_MIN} minutes`}
        value={poller.oldestMin}
        max={POLLER_SCALE_MIN}
        target={POLLER_SCALE_MIN}
        {...(poller.oldestMin >= POLLER_SCALE_MIN ? { color: VX.status.bad } : {})}
        startCaption={null}
        endCaption={`${POLLER_SCALE_MIN} min`}
      />
    ),
  }
}

function revertsCell({ reverts }: StripModel): StatStripCell {
  const caption = 'Reverts · reopens'
  if (reverts.reverts === null && reverts.reopens === null) {
    return {
      key: 'reverts',
      caption,
      value: '—',
      qualifier: noData(reverts.unavailable ?? 'not reported'),
    }
  }
  const bad = (reverts.reverts ?? 0) > 0
  return {
    key: 'reverts',
    caption,
    value: reverts.reverts === null ? '—' : String(reverts.reverts),
    unit: reverts.reverts === 1 ? 'revert' : 'reverts',
    valueColor: bad ? VX.status.bad : undefined,
    qualifier: `${reverts.reopens === null ? '—' : reverts.reopens} reopen after fixed · last ${reverts.windowDays} d`,
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
        <Text fz="xl" fw={600} ff="monospace" lh={1.1}>
          —
        </Text>
        <Text size="xs" c="dimmed">
          {noData('budget not reported')}
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
  const footer = deriveBudget(budget).map((meter) => ({
    key: meter.key,
    content: <BudgetMeterRow meter={meter} />,
  }))
  return <StatStrip cells={cells} footer={footer} />
}
