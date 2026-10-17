import type { ReactNode } from 'react'
import { Card, Group, Stack, Text } from '@mantine/core'
import { Meter, StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { fmtDegrees, fmtShortDay } from '../formulas'
import type { Night } from '../types'

function GateRow({
  failed,
  label,
  detail,
  children,
}: {
  failed: boolean
  label: string
  detail: string
  children?: ReactNode
}) {
  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap">
        <StatusDot color={failed ? VX.status.warn : VX.status.good} />
        <Text size="sm" fw={600}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {failed ? 'failed' : 'passed'}
        </Text>
      </Group>
      <Text size="sm" c="dimmed">
        {detail}
      </Text>
      {children}
    </Stack>
  )
}

/**
 * The hard gates of the verdict's night, one status-dot row each. Pass/fail is the API's (`killers`
 * ids); the meters only draw the reading against its limit so a small gap stays a visible length.
 */
export function GatesCard({ night, moonLimit }: { night: Night; moonLimit: number }) {
  const failedIds = new Set(night.killers.map((k) => k.id))
  const reasonOf = (id: string) => night.killers.find((k) => k.id === id)?.reason
  const reading = night.gateCoreAltitude
  const pct = Math.round(night.moon.illumination * 100)
  const limitPct = Math.round(moonLimit * 100)
  const dark = night.darkMinutes > 0
  const failedCount = failedIds.size
  const moonDetail =
    reasonOf('moon') ??
    (!dark
      ? 'no astronomical night'
      : night.moon.illumination < moonLimit
        ? `${pct} % lit · under the limit`
        : `${pct} % lit · down in the window`)
  const coreDetail =
    reasonOf('core-altitude') ??
    (reading === null || night.coreGateDeg === null
      ? 'no astronomical night'
      : `closest to the gate: ${fmtDegrees(reading)} against ${fmtDegrees(night.coreGateDeg)}`)

  return (
    <Card data-shot="gates-card">
      <Stack gap="md">
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Text fw={600} size="sm">
            {failedCount === 0 ? 'All gates clear' : `${failedCount} of 3 gates failed`}
          </Text>
          <Text size="xs" c="dimmed" ff="monospace">
            {fmtShortDay(night.date)}
          </Text>
        </Group>

        <GateRow
          failed={failedIds.has('darkness')}
          label="Darkness"
          detail={
            night.darkMinutes > 0 ? 'astronomical night present' : (reasonOf('darkness') ?? 'none')
          }
        />

        <GateRow failed={failedIds.has('core-altitude')} label="Core" detail={coreDetail} />

        <GateRow failed={failedIds.has('moon')} label="Moon" detail={moonDetail}>
          <Meter
            label="Moon illumination against its limit"
            value={pct}
            max={100}
            target={limitPct}
            tone="muted"
            format={(v) => `${v.toFixed(0)} %`}
            startCaption={null}
            endCaption={`limit ${limitPct} %`}
          />
        </GateRow>
      </Stack>
    </Card>
  )
}
