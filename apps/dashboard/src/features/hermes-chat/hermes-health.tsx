import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Box, Group, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { hermesQueries } from '../../lib/queries/hermes'
import classes from './hermes-health.module.css'

/**
 * `GET /hermes/health` as a status dot and a word. Explains why a send will fail before it does.
 * Unknown (first load, or the probe itself failed) reads as a neutral dot, never as reachable.
 */
export function HermesHealth() {
  const { data } = useQuery({
    ...hermesQueries.health(),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })
  const ok = data?.status === 'ok'
  const degraded = data?.status === 'degraded'
  const word = ok
    ? 'Hermes reachable'
    : degraded
      ? 'Hermes degraded · replies may fail'
      : 'Hermes status unknown'
  const color = ok ? VX.status.good : degraded ? VX.status.warn : VX.muted

  return (
    <Group gap="xs" wrap="nowrap">
      <Box className={classes['dot']} style={{ background: color }} />
      <Text size="sm" c="dimmed" component="span">
        {word}
      </Text>
    </Group>
  )
}
