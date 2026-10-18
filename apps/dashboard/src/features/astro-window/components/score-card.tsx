import { Card, Group, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { fmtShortDay } from '../formulas'
import type { Night } from '../types'

/**
 * What carries the score: one bar per scored factor (value 0–100 %), its share of the total weight
 * trailing in muted ink. A gated night has no score — one line names the gate instead.
 */
export function ScoreCard({ night }: { night: Night }) {
  const out = night.verdict === 'out'
  const scored = night.factors.filter((f) => f.value !== null)
  const unscored = night.factors.filter((f) => f.value === null)
  const totalWeight = night.factors.reduce((sum, f) => sum + f.weight, 0)

  return (
    <Card data-shot="score-card">
      <Stack gap="sm">
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Text fw={600} size="md">
            Score · {fmtShortDay(night.date)}
          </Text>
          {!out && (
            <Text size="sm" c="dimmed">
              {night.score}/100
            </Text>
          )}
        </Group>
        {out ? (
          <Text size="sm" c="dimmed">
            Score withheld on a ruled-out night
          </Text>
        ) : (
          <>
            <BarList
              label="Score factors"
              max={100}
              format={(v) => `${Math.round(v)} %`}
              items={scored.map((f) => ({
                key: f.id,
                label: f.label,
                value: (f.value ?? 0) * 100,
                secondary: `weight ${Math.round((f.weight / totalWeight) * 100)} %`,
              }))}
            />
            {unscored.length > 0 && (
              <Text size="xs" c="dimmed">
                Not scored: {unscored.map((f) => f.label.toLowerCase()).join(', ')}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Card>
  )
}
