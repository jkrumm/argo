import { formatAgo, formatAgoWhole, formatDuration } from '../../lib/format'
import { Box, SimpleGrid, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { EntityCard, type EntityCardCell } from './entity-card'
import { StatusChip, type StatusTone } from './status-chip'
import { longestRunMs, STATE_LABEL, type AgentState, type ProjectGroup } from './model'
import classes from './project-cards.module.css'

const STATE_TONE: Record<AgentState, StatusTone> = {
  needs_you: 'bad',
  stale: 'warn',
  working: 'neutral',
  idle: 'neutral',
  done: 'neutral',
  unknown: 'neutral',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function gitCell(git: ProjectGroup['git']): Pick<EntityCardCell, 'value' | 'small' | 'unit'> {
  if (!git) return { value: '—' }
  const tree = git.dirty ? 'dirty' : 'clean'
  if (git.ahead === 0 && git.behind === 0) return { value: 'in sync', small: true, unit: tree }
  return { value: `↑${git.ahead} ↓${git.behind}`, unit: tree }
}

function ProjectCard({ group, now }: { group: ProjectGroup; now: number }) {
  const running = group.working.length
  const longest = longestRunMs(group.working, now)
  const waiting = group.counts.needs_you
  const state: AgentState = waiting > 0 ? 'needs_you' : 'working'
  return (
    <EntityCard
      identity={
        <Stack gap={0}>
          <Text size="sm" fw={600} truncate>
            {group.name}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            {group.git ? group.git.branch : plural(group.agents.length, 'agent', 'agents')}
          </Text>
        </Stack>
      }
      status={<StatusChip tone={STATE_TONE[state]} label={STATE_LABEL[state]} />}
      cells={[
        {
          caption: 'Running',
          value: String(running),
          unit: running === 1 ? 'agent' : 'agents',
          ...(longest === null ? {} : { note: `longest ${formatDuration(longest)}` }),
        },
        {
          caption: 'Last activity',
          value: group.lastActivityAt === null ? '—' : formatAgo(now - group.lastActivityAt),
        },
        { caption: 'Git · ahead / behind', ...gitCell(group.git) },
      ]}
      now={
        <>
          <Text size="sm" c="dimmed" span>
            {waiting > 0 && running === 0 ? 'Waiting' : 'Now'}
          </Text>
          <Text size="sm" span className={classes.nowValue}>
            {group.now ?? (waiting > 0 ? 'on you' : 'working')}
          </Text>
        </>
      }
    />
  )
}

/** One line per project without a running agent: name, worst state, last activity. */
function QuietList({ groups, now }: { groups: ProjectGroup[]; now: number }) {
  return (
    <ul className={classes.quiet} aria-label="Projects without a running agent">
      {groups.map((g) => (
        <li key={g.name} className={classes.quietRow}>
          <Text size="sm" truncate>
            {g.name}
          </Text>
          <StatusChip tone={STATE_TONE[g.worst]} label={STATE_LABEL[g.worst]} />
          <Text size="sm" ff="monospace" c="dimmed" span className={classes.quietAge}>
            {g.lastActivityAt === null ? '—' : formatAgoWhole(now - g.lastActivityAt)}
          </Text>
        </li>
      ))}
    </ul>
  )
}

type Props = {
  active: ProjectGroup[]
  quiet: ProjectGroup[]
  now: number
}

/**
 * One entity card per project with a working or waiting agent, then every other project as one
 * compact row (worst state, last activity) so no project is dropped.
 */
export function ProjectCards({ active, quiet, now }: Props) {
  const count = active.length + quiet.length
  if (count === 0) return null
  return (
    <Section title="Projects" count={count}>
      <Stack gap="md">
        {active.length > 0 ? (
          <SimpleGrid
            type="container"
            cols={{ base: 1, [CONTAINER_KEYS.regular]: 2, [CONTAINER_KEYS.wide]: 3 }}
          >
            {active.map((g, i) => (
              <Box key={g.name} data-shot={`project-card-${i + 1}`} data-shot-absent="empty">
                <ProjectCard group={g} now={now} />
              </Box>
            ))}
          </SimpleGrid>
        ) : null}
        {quiet.length > 0 ? (
          <Stack
            gap="xs"
            className={classes.quietBox}
            data-shot="quiet-projects"
            data-shot-absent="empty"
          >
            <Text className={classes.listHead}>
              No agent running · {plural(quiet.length, 'project', 'projects')}
            </Text>
            <QuietList groups={quiet} now={now} />
          </Stack>
        ) : null}
      </Stack>
    </Section>
  )
}
