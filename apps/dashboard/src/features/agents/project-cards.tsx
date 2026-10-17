import { Box, SimpleGrid, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { EntityCard, type EntityCardCell } from './entity-card'
import { StatusChip, type StatusTone } from './status-chip'
import { ageAgo, STATE_LABEL, type AgentRow, type AgentState, type ProjectGroup } from './model'
import classes from './project-cards.module.css'

const DAY_MS = 86_400_000
const MAX_BARS = 12

const STATE_TONE: Record<AgentState, StatusTone> = {
  needs_you: 'bad',
  stale: 'warn',
  working: 'neutral',
  idle: 'neutral',
  done: 'neutral',
  unknown: 'neutral',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One bar per running agent, taller the longer it has run (capped at a day). */
function AgeBars({ agents, now }: { agents: AgentRow[]; now: number }) {
  const shown = agents.slice(0, MAX_BARS)
  return (
    <span
      className={classes.bars}
      role="img"
      aria-label={`Run time of ${plural(agents.length, 'running agent', 'running agents')}, capped at 24 h`}
    >
      {shown.map((a) => {
        const since = a.startedAt ?? a.lastActivityAt ?? now
        const share = Math.min(1, Math.max(0, (now - since) / DAY_MS))
        return (
          <Box
            key={a.id}
            component="span"
            className={classes.bar}
            h={`${Math.round(35 + share * 65)}%`}
          />
        )
      })}
    </span>
  )
}

/** The share of each source among the project's agents, as one neutral two-to-three part bar. */
function SourceBar({ sources }: { sources: Record<string, number> }) {
  const entries = Object.entries(sources).toSorted((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  if (entries.length < 2) return null
  return (
    <span
      className={classes.share}
      role="img"
      aria-label={entries.map(([k, n]) => `${k} ${n}`).join(', ')}
    >
      {entries.map(([name, n], i) => (
        <Box
          key={name}
          component="span"
          className={classes.shareFill}
          style={{ width: `${(n / total) * 100}%`, opacity: 1 - i * 0.35 }}
        />
      ))}
    </span>
  )
}

function sourceCell(
  sources: Record<string, number>,
): Pick<EntityCardCell, 'value' | 'small' | 'unit'> {
  const entries = Object.entries(sources).toSorted((a, b) => b[1] - a[1])
  if (entries.length === 0) return { value: '—' }
  const [first, ...rest] = entries
  const unit = rest.map(([name, n]) => `${name} ${n}`).join(' · ')
  return { value: `${first![0]} ${first![1]}`, small: true, ...(unit && { unit }) }
}

function gitCell(git: ProjectGroup['git']): Pick<EntityCardCell, 'value' | 'small' | 'unit'> {
  if (!git) return { value: '—' }
  const tree = git.dirty ? 'dirty' : 'clean'
  if (git.ahead === 0 && git.behind === 0) return { value: 'in sync', small: true, unit: tree }
  return { value: `↑${git.ahead} ↓${git.behind}`, unit: tree }
}

function ProjectCard({ group, now }: { group: ProjectGroup; now: number }) {
  const running = group.working.length
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
          visual: running > 1 ? <AgeBars agents={group.working} now={now} /> : undefined,
        },
        {
          caption: 'Last activity',
          value: group.lastActivityAt === null ? '—' : ageAgo(now - group.lastActivityAt),
        },
        {
          caption: 'Source',
          ...sourceCell(group.sources),
          visual: <SourceBar sources={group.sources} />,
        },
        { caption: 'Git · ahead / behind', ...gitCell(group.git) },
      ]}
      now={
        <>
          <Text size="sm" c="dimmed" span>
            {waiting > 0 && running === 0 ? 'Waiting' : 'Now'}
          </Text>
          <Text size="sm" span truncate>
            {group.now ?? (waiting > 0 ? 'on you' : 'working')}
          </Text>
        </>
      }
    />
  )
}

/** One line per project without a running agent: name, agent count, worst state, age. */
function QuietList({ groups, now }: { groups: ProjectGroup[]; now: number }) {
  return (
    <ul className={classes.quiet} aria-label="Projects without a running agent">
      {groups.map((g) => (
        <li key={g.name} className={classes.quietRow}>
          <Text size="sm" truncate>
            {g.name}
          </Text>
          <Text size="sm" ff="monospace" c="dimmed" span>
            {plural(g.agents.length, 'agent', 'agents')}
          </Text>
          <StatusChip tone={STATE_TONE[g.worst]} label={STATE_LABEL[g.worst]} />
          <Text size="sm" ff="monospace" c="dimmed" span className={classes.quietAge}>
            {g.lastActivityAt === null ? '—' : ageAgo(now - g.lastActivityAt)}
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
 * compact row (agent count, worst state, last activity) so no project is dropped.
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
              <Box key={g.name} data-shot={`project-card-${i + 1}`}>
                <ProjectCard group={g} now={now} />
              </Box>
            ))}
          </SimpleGrid>
        ) : null}
        {quiet.length > 0 ? (
          <Stack gap="xs" className={classes.quietBox} data-shot="quiet-projects">
            <Text className={classes.listHead}>No agent running · {quiet.length} projects</Text>
            <QuietList groups={quiet} now={now} />
          </Stack>
        ) : null}
      </Stack>
    </Section>
  )
}
