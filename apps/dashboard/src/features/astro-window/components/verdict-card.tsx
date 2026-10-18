import { Box, Group, Stack, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { DecisionCard } from '../../../components/upstream/decision-card'
import {
  coreGateDetail,
  coreGateFailure,
  lowCloudHarm,
  verdictFacts,
  verdictHeadline,
  verdictStatus,
} from '../formulas'
import type { HourlyPoint, Night } from '../types'

type Row = { key: string; label: string; state: string; tone: string; detail: string }

/** One gate or factor: a status dot, its name, a state word, and one line of cause in plain words. */
function GateRow({ label, state, tone, detail }: Omit<Row, 'key'>) {
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="nowrap">
        <StatusDot color={tone} />
        <Text size="sm" fw={600}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {state}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {detail}
      </Text>
    </Stack>
  )
}

/**
 * The gates in the API's order, then low cloud when it ends the night. Pass or fail is the API's
 * (`killers` ids); low cloud is scored, never gated, so its row says `scored`, not passed or failed.
 */
function rowsOf(night: Night, moonLimit: number, lowCloud: string | null): Row[] {
  const failed = new Set(night.killers.map((k) => k.id))
  const reasonOf = (id: string) => night.killers.find((k) => k.id === id)?.reason
  const dark = night.darkMinutes > 0
  const gate = (id: string, label: string, detail: string, isFailed = failed.has(id)): Row => ({
    key: id,
    label,
    state: isFailed ? 'failed' : 'passed',
    tone: isFailed ? VX.status.warn : VX.status.good,
    detail,
  })
  const rows = [
    gate(
      'darkness',
      'Darkness',
      dark ? 'astronomical night present' : (reasonOf('darkness') ?? 'none'),
    ),
    gate('core-altitude', 'Core', coreGateDetail(night), coreGateFailure(night)),
    gate(
      'moon',
      'Moon',
      reasonOf('moon') ??
        (!dark
          ? 'no astronomical night'
          : night.moon.illumination < moonLimit
            ? 'under its limit'
            : 'down or behind the skyline while it is dark'),
    ),
  ]
  if (lowCloud !== null) {
    rows.push({
      key: 'cloud-low',
      label: 'Low cloud',
      state: 'scored, not a gate',
      tone: VX.status.warn,
      detail: lowCloud,
    })
  }
  return rows
}

/**
 * The one verdict for the selected night: a status dot + word, one line stating why, the night it
 * is about, and the gates it was judged by, each with a cause in words. The core reading against
 * its gate is drawn in the Core cell and the moon in the Moon cell, so this card repeats neither.
 */
export function VerdictCard({
  night,
  nights,
  hourly,
  moonLimit,
}: {
  night: Night
  nights: readonly Night[]
  hourly: readonly HourlyPoint[]
  moonLimit: number
}) {
  const status = verdictStatus(night)
  const lowCloud = lowCloudHarm(night, hourly)
  const facts = verdictFacts(night, nights, { lowCloudShown: lowCloud !== null })

  return (
    <Box data-shot="verdict-card">
      <DecisionCard
        question={verdictHeadline(night)}
        status={
          <Group gap={6} wrap="nowrap">
            <StatusDot color={status.color} />
            <Text size="sm" fw={600}>
              {status.word}
            </Text>
          </Group>
        }
        facts={facts}
        evidence={
          <Stack gap="sm">
            {rowsOf(night, moonLimit, lowCloud).map(({ key, ...row }) => (
              <GateRow key={key} {...row} />
            ))}
          </Stack>
        }
      />
    </Box>
  )
}
