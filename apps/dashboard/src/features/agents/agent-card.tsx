import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import { RECOMMENDATION_ICON, STATE_COLOR, STATE_LABEL, type AgentRow } from './model'

type Props = {
  agent: AgentRow
}

/**
 * One agent, one card, no horizontal scroll — the phone replacement for a row of
 * `AgentsTable`'s 6-column table (see `agents-table.tsx` for why the table itself cannot flex
 * below `sm`: two of its six columns are free prose, and basalt's own note measured a 5-column
 * table at 448px of min-content). Four lines: state + project + last activity, the title, the
 * standing/blocker prose, and a compact recommendation + source/tier line — the same fields the
 * table renders, just stacked instead of scrolled.
 */
export function AgentCard({ agent }: Props) {
  const standingText = agent.blocker ?? agent.standing
  const rec = agent.recommendation

  return (
    <Card padding="sm">
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap="xs" wrap="nowrap" miw={0}>
            <Badge variant="light" color={STATE_COLOR[agent.state]} style={{ flexShrink: 0 }}>
              {STATE_LABEL[agent.state]}
            </Badge>
            <Text size="sm" fw={600} lineClamp={1}>
              {agent.project}
            </Text>
          </Group>
          {agent.lastActivityAt ? (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
              {relativeTime(agent.lastActivityAt)}
            </Text>
          ) : null}
        </Group>

        {agent.title ? (
          <Text size="sm" lineClamp={2}>
            {agent.title}
          </Text>
        ) : null}

        {standingText ? (
          <Text size="sm" c={agent.blocker ? 'red' : 'dimmed'} lineClamp={3}>
            {standingText}
          </Text>
        ) : null}

        <Group gap={6} wrap="nowrap">
          {rec ? (
            <>
              <Text ff="monospace" size="sm" component="span">
                {RECOMMENDATION_ICON[rec] ?? '·'}
              </Text>
              <Text size="xs" c="dimmed" component="span">
                {rec}
                {agent.recommendationStale ? ' (stale)' : ''}
              </Text>
              <Text size="xs" c="dimmed" component="span">
                ·
              </Text>
            </>
          ) : null}
          <Text size="xs" c="dimmed" component="span" lineClamp={1}>
            {agent.source ?? '—'}
            {agent.tier ? ` · ${agent.tier}` : ''}
          </Text>
        </Group>
      </Stack>
    </Card>
  )
}
