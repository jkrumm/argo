import type { ReactNode } from 'react'
import { Box, Card, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { SIDE_PANEL_HEIGHT } from '../constants'
import {
  fmtDegrees,
  fmtLocalClock,
  fmtMinutes,
  fmtPercent,
  fmtPercent100,
  moonPhaseLabel,
} from '../formulas'
import type { Factor, Night } from '../types'

function FactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={4}>
      <Text
        fw={700}
        tt="uppercase"
        c="dimmed"
        style={{ fontSize: VX.text.micro, letterSpacing: 0.4 }}
      >
        {title}
      </Text>
      <Stack gap={3}>{children}</Stack>
    </Stack>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text ff="monospace" size="xs" fw={500} ta="right">
        {value}
      </Text>
    </Group>
  )
}

function FactorRow({ factor }: { factor: Factor }) {
  const pct = factor.value !== null ? Math.round(factor.value * 100) : null
  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="xs" c="dimmed" truncate>
          {factor.label}
        </Text>
        <Group gap={6} wrap="nowrap">
          <Text ff="monospace" size="xs" fw={500}>
            {factor.detail ?? (pct !== null ? `${pct}%` : '—')}
          </Text>
          <Text ff="monospace" size="xs" c="dimmed">
            ×{factor.weight}
          </Text>
        </Group>
      </Group>
      {/* Square-ended meter: a 3px bar with rounded caps reads as decoration at this
          density, and the `bg` prop keeps the fill on-token without an inline surface. */}
      <Box h={3} w="100%" bg={VX.surface.subtle}>
        <Box h={3} w={`${pct ?? 0}%`} bg={VX.accentFill} />
      </Box>
    </Stack>
  )
}

export function NightFacts({
  night,
  bortle,
  timeZone,
}: {
  night: Night
  bortle: number | null
  timeZone: string
}) {
  return (
    <Card py="xs" px="sm" h={SIDE_PANEL_HEIGHT}>
      <ScrollArea h="100%" type="hover" scrollbars="y" scrollbarSize={9}>
        <Stack gap="md" pr="xs">
          <FactGroup title="Darkness">
            <FactRow label="Astro dark start" value={fmtLocalClock(night.darkStart, timeZone)} />
            <FactRow label="Astro dark end" value={fmtLocalClock(night.darkEnd, timeZone)} />
            <FactRow label="Duration" value={fmtMinutes(night.darkMinutes)} />
          </FactGroup>

          <FactGroup title="Galactic core">
            <FactRow label="Transit (local)" value={night.localTransit} />
            <FactRow label="Max altitude" value={fmtDegrees(night.maxCoreAltitude)} />
            <FactRow
              label="Window"
              value={night.window ? `${night.window.localStart}–${night.window.localEnd}` : '—'}
            />
            <FactRow
              label="Peak alt. / az."
              value={
                night.window
                  ? `${fmtDegrees(night.window.peakCoreAltitude)} / ${fmtDegrees(night.window.peakCoreAzimuth)}`
                  : '—'
              }
            />
          </FactGroup>

          <FactGroup title="Moon">
            <FactRow label="Illumination" value={fmtPercent(night.moon.illumination)} />
            <FactRow label="Phase" value={moonPhaseLabel(night.moon.phase)} />
            <FactRow label="Rise" value={fmtLocalClock(night.moon.rise, timeZone)} />
            <FactRow label="Set" value={fmtLocalClock(night.moon.set, timeZone)} />
            <FactRow
              label="Max alt. in window"
              value={night.window ? fmtDegrees(night.window.maxMoonAltitude) : '—'}
            />
          </FactGroup>

          <FactGroup title="Sky">
            <FactRow label="Cloud low" value={fmtPercent100(night.weather.cloudLow)} />
            <FactRow label="Cloud mid" value={fmtPercent100(night.weather.cloudMid)} />
            <FactRow label="Cloud high" value={fmtPercent100(night.weather.cloudHigh)} />
            <FactRow
              label="Transparency"
              value={night.weather.transparency !== null ? `${night.weather.transparency}/8` : '—'}
            />
            <FactRow label="Bortle" value={bortle !== null ? String(bortle) : '—'} />
          </FactGroup>

          <FactGroup title="Score">
            {night.factors.map((factor) => (
              <FactorRow key={factor.id} factor={factor} />
            ))}
          </FactGroup>
        </Stack>
      </ScrollArea>
    </Card>
  )
}
