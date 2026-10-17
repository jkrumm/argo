import { Group, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import type { Location, Sources } from '../types'

const SOURCES: ReadonlyArray<{ key: keyof Sources; name: string }> = [
  { key: 'dwdIcon', name: 'DWD ICON' },
  { key: 'globalForecast', name: 'Global' },
  { key: 'sevenTimer', name: '7Timer' },
]

/** Forecast inputs as status dots: a degraded upstream is a fact about the verdict's trust, red only when down. */
export function SourcesFooter({
  sources,
  darknessSource,
}: {
  sources: Sources
  darknessSource: Location['darknessSource']
}) {
  return (
    <Group gap="sm" wrap="nowrap" data-shot="sources-footer">
      <Text size="xs" c="dimmed">
        Forecast sources
      </Text>
      {SOURCES.map(({ key, name }) => (
        <Group key={key} gap={6} wrap="nowrap">
          <StatusDot color={sources[key] ? VX.status.good : VX.status.bad} />
          <Text size="xs" c="dimmed">
            {name} {sources[key] ? 'ok' : 'down'}
          </Text>
        </Group>
      ))}
      {darknessSource === 'unknown' && (
        <Group gap={6} wrap="nowrap">
          <StatusDot color={VX.status.warn} />
          <Text size="xs" c="dimmed">
            Sky darkness degraded
          </Text>
        </Group>
      )}
    </Group>
  )
}
