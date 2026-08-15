import type { ReactNode } from 'react'
import { Box, Card, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { SIDE_PANEL_HEIGHT } from '../constants'
import {
  fmtBearing,
  fmtDegrees,
  fmtKnots,
  fmtMetres,
  fmtMinutes,
  fmtOffDeadOffshore,
  fmtPercent,
  fmtSeconds,
  windKindLabel,
} from '../formulas'
import type { Day, Factor, Killer, Location } from '../types'

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

/** One row per killer for a gated day's Score group, replacing the meters — a gated day has no
 * `factors[]` to render, and the killer's `reason` sentence is the most decision-relevant text
 * available, so it gets the value column instead of truncating in a meter row. */
function KillerRow({ killer }: { killer: Killer }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
        {killer.label}
      </Text>
      <Text ff="monospace" size="xs" fw={500} ta="right" style={{ flex: 1, minWidth: 0 }}>
        {killer.reason}
      </Text>
    </Group>
  )
}

export function DayFacts({ day, location }: { day: Day; location: Location }) {
  const isRuledOut = day.factors.length === 0 && day.killers.length > 0

  return (
    // `mih` rather than `h`: the five fact groups are the densest, most
    // decision-relevant block on the page, and at a fixed height the Score group
    // fell below a scroll fold where neither the operator nor a critic ever saw
    // it (the same fix the Astro Window facts panel needed). The panel sizes to
    // its content and the map matches it.
    <Card py="xs" px="sm" mih={SIDE_PANEL_HEIGHT}>
      <ScrollArea h="100%" type="hover" scrollbars="y" scrollbarSize={9}>
        <Stack gap="md" pr="xs">
          <FactGroup title="Session">
            <FactRow label="Start" value={day.window?.localStart ?? '—'} />
            <FactRow label="End" value={day.window?.localEnd ?? '—'} />
            <FactRow label="Length" value={fmtMinutes(day.window?.minutes ?? null)} />
            <FactRow label="Peak hour" value={day.window?.localPeakTime ?? '—'} />
          </FactGroup>

          <FactGroup title="Swell">
            <FactRow label="Height" value={fmtMetres(day.conditions.swellHeight)} />
            <FactRow label="Period" value={fmtSeconds(day.conditions.swellPeriod)} />
            <FactRow
              label="Direction"
              value={
                day.conditions.swellDirection !== null
                  ? `from ${Math.round(day.conditions.swellDirection)}°`
                  : '—'
              }
            />
            <FactRow label="Total wave height" value={fmtMetres(day.conditions.waveHeight)} />
          </FactGroup>

          <FactGroup title="Wind">
            <FactRow label="Speed" value={fmtKnots(day.conditions.windSpeed)} />
            <FactRow label="Direction" value={fmtDegrees(day.conditions.windDirection)} />
            <FactRow label="Kind" value={windKindLabel(day.conditions.windKind)} />
            <FactRow
              label="Off dead-offshore"
              value={fmtOffDeadOffshore(day.conditions.windDirection, location.shoreNormal)}
            />
          </FactGroup>

          <FactGroup title="Spot">
            <FactRow label="Shore normal" value={fmtBearing(location.shoreNormal)} />
            <FactRow
              label="Drive time"
              value={location.driveMinutes !== null ? fmtMinutes(location.driveMinutes) : '—'}
            />
            <FactRow label="Country" value={location.country} />
          </FactGroup>

          {isRuledOut ? (
            <FactGroup title="Ruled Out">
              {day.killers.map((killer) => (
                <KillerRow key={killer.id} killer={killer} />
              ))}
            </FactGroup>
          ) : (
            <FactGroup title="Score">
              <FactRow label="Coverage" value={fmtPercent(day.coverage)} />
              {day.factors.map((factor) => (
                <FactorRow key={factor.id} factor={factor} />
              ))}
            </FactGroup>
          )}
        </Stack>
      </ScrollArea>
    </Card>
  )
}
