import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Box, Button, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import { Meter, Section } from 'basalt-ui'
import type { UsageKpis } from '../../lib/queries/agent-performance'
import { LANE_COLOR } from './colors'
import { LANES, fmtUsd, issueRows, runsLabel, type IssueRow } from './model'
import { SourceLine } from './source-line'

const VISIBLE = 10

type Props = { query: UseQueryResult<UsageKpis>; issues: UsageKpis['issues']; costBasis: string }

/** One lane colour key, shared by every row's bar. */
function LaneLegend() {
  return (
    <Group gap="md" role="list" aria-label="Lane colours">
      {LANES.map((lane) => (
        <Group key={lane} gap={6} role="listitem" wrap="nowrap">
          <Box w={10} h={10} bg={LANE_COLOR[lane]} aria-hidden />
          <Text size="xs" c="dimmed">
            {lane}
          </Text>
        </Group>
      ))}
    </Group>
  )
}

function IssueItem({ row }: { row: IssueRow }) {
  const [open, setOpen] = useState(false)
  const panelId = `issue-lanes-${row.issueId}`
  return (
    <Stack gap={4} role="listitem">
      <UnstyledButton
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        w="100%"
      >
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap={6} wrap="nowrap" miw={0}>
            <IconChevronDown
              size={14}
              aria-hidden
              style={{ transform: open ? undefined : 'rotate(-90deg)', flexShrink: 0 }}
            />
            <Text size="sm" fw={600} truncate>
              {row.title}
            </Text>
          </Group>
          <Text size="sm" ff="monospace">
            {fmtUsd(row.costUsd)}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" pl="md">
          {row.span} · {runsLabel(row.runs)}
        </Text>
      </UnstyledButton>
      {row.costUsd > 0 ? (
        <Meter
          label={`Cost of ${row.title} by lane`}
          size="row"
          max={row.costUsd}
          format={fmtUsd}
          segments={row.lanes
            .filter((l) => l.costUsd > 0)
            .map((l) => ({ value: l.costUsd, label: l.lane, color: LANE_COLOR[l.lane] }))}
          startCaption={null}
          endCaption={null}
          reading={false}
        />
      ) : null}
      <Collapse expanded={open} id={panelId}>
        <Stack gap="xs" pl="md" pb="xs">
          {row.lanes.map((l) => (
            <Group key={l.lane} justify="space-between" wrap="nowrap" gap="sm">
              <Group gap={6} wrap="nowrap">
                <Box w={10} h={10} bg={LANE_COLOR[l.lane]} aria-hidden />
                <Text size="xs">{l.lane}</Text>
              </Group>
              <Text size="xs" c="dimmed" ta="right">
                {runsLabel(l.runs)} · {l.requests} requests ·{' '}
                <Text span size="xs" ff="monospace" c="inherit">
                  {fmtUsd(l.costUsd)}
                </Text>
              </Text>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  )
}

/** Cost per factory Issue, newest first, with a segmented bar of its lanes and the breakdown on demand. */
export function IssuesSection({ query, issues, costBasis }: Props) {
  const [all, setAll] = useState(false)
  const rows = issueRows(issues)
  const shown = all ? rows : rows.slice(0, VISIBLE)

  return (
    <Section
      title="Cost per Issue"
      count={rows.length}
      query={query}
      empty={{ title: 'No Issue activity in this window' }}
    >
      <Stack gap="sm" data-shot="issues">
        {rows.length === 0 ? null : (
          <>
            <LaneLegend />
            <Stack gap="md" role="list" aria-label="Issues by cost, newest first">
              {shown.map((row) => (
                <IssueItem key={row.issueId} row={row} />
              ))}
            </Stack>
            {rows.length > shown.length ? (
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                onClick={() => setAll(true)}
                style={{ alignSelf: 'flex-start' }}
              >
                Show {rows.length - shown.length} more
              </Button>
            ) : null}
          </>
        )}
        <SourceLine>
          usage.records_unique by issue_id (lead-&lt;n&gt;-&lt;k&gt; sessions; subagents inherit the
          lead&apos;s Issue; cost and span count only the selected weeks) · {costBasis}
        </SourceLine>
      </Stack>
    </Section>
  )
}
