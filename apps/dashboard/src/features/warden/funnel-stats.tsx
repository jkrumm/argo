import { StatCard, StatGroup } from 'basalt-ui'
import { Group, Text } from '@mantine/core'
import type { WardenBudget, WardenMetrics } from '../../lib/queries/warden'
import { deriveFunnel, formatTileValue, type FunnelTile } from './model'

type Props = {
  metrics: WardenMetrics | undefined
  budget: WardenBudget | undefined
}

/** The tile's `info` tooltip: the long descriptive label always, plus the `unavailable` reason
 * appended when the tile reads "n/a" — the short `label` on the card body is mobile-width, this is
 * where the full name lives. */
function tileInfo(tile: FunnelTile): string {
  return tile.unavailable ? `${tile.description} — ${tile.unavailable}` : tile.description
}

/**
 * The six funnel tiles plus the two dispatch-budget lines. A `null` value renders as "n/a" with its
 * `unavailable` reason surfaced through the `info` glyph — never a bare 0, which would read as a
 * measured zero rather than an absent reading.
 */
export function FunnelStats({ metrics, budget }: Props) {
  const tiles = deriveFunnel(metrics)

  return (
    <>
      <StatGroup cols={3}>
        {tiles.map((tile) => (
          <StatCard
            key={tile.key}
            title={tile.label}
            value={formatTileValue(tile)}
            info={tileInfo(tile)}
            {...(tile.detail ? { subtitle: tile.detail } : {})}
          />
        ))}
      </StatGroup>
      {budget ? (
        <Group gap="md">
          <Text size="sm" c="dimmed">
            Dispatch budget:{' '}
            <Text span fw={600} c="inherit">
              {budget.usedToday ?? '—'}/{budget.max ?? '—'}
            </Text>{' '}
            used today
          </Text>
          <Text size="sm" c="dimmed">
            Implement budget:{' '}
            <Text span fw={600} c="inherit">
              {budget.implementToday ?? '—'}/{budget.implementMax ?? '—'}
            </Text>{' '}
            used today
          </Text>
        </Group>
      ) : null}
    </>
  )
}
