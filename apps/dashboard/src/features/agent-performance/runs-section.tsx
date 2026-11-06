import type { UseQueryResult } from '@tanstack/react-query'
import { Stack } from '@mantine/core'
import { Section } from 'basalt-ui'
import type { UsageKpis } from '../../lib/queries/agent-performance'
import { typeColor } from './colors'
import { SUBAGENT_SOURCE, runsByWeek, type RunsWeekRow } from './model'
import { SourceLine } from './source-line'
import { WeeklyBars } from './weekly-bars'

type Props = {
  query: UseQueryResult<UsageKpis>
  rows: UsageKpis['byWeek']
  keys: readonly string[]
}

/** Runs per week for the five busiest types; the rest fold into one grey `(other)`. */
export function RunsSection({ query, rows, keys }: Props) {
  const { series, weeks } = runsByWeek(rows, keys)
  return (
    <Section
      title="Runs per week by type"
      query={query}
      empty={{ title: 'No subagent or worker runs in this window' }}
    >
      <Stack gap="sm" data-shot="runs">
        {series.length === 0 ? null : (
          <WeeklyBars
            ariaLabel="Subagent and worker runs per week by type"
            data={weeks}
            bars={series.map((s, i) => ({
              key: s.key,
              label: s.label,
              color: typeColor(i, s.other),
              getValue: (d: RunsWeekRow) => d.runs[s.key] ?? 0,
              formatValue: (v) => `${v} runs`,
            }))}
          />
        )}
        <SourceLine>{SUBAGENT_SOURCE}</SourceLine>
      </Stack>
    </Section>
  )
}
