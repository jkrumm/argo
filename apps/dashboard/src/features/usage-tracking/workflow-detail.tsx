/**
 * The detail of an agw workflow on credit: its steps and models, the purpose split and what a run
 * costs. The headline figure is the workflow's row of the Demand column's own query, so the card above
 * and this view agree; the steps and models are that workflow's rows of `/usage/demand`.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Grid, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type DemandRow, type Range } from '../../lib/queries/usage'
import {
  CREDIT_PAYERS,
  cacheShare,
  costPerRun,
  fmtPct,
  fmtUsd,
  purposeSegments,
  workflowRow,
} from './flow-model'
import { PURPOSE_STYLE } from './flow-ink'
import { SegmentBar, SegmentLegend } from './flow-parts'
import { periodNoun } from './model'

const NUMBER = new Intl.NumberFormat('en-GB')

const STEPS_INFO =
  'The workflow’s steps over the range, ranked by cost: runs, cost per run and the share of tokens read from the prompt cache (cache-read over every token the step processed).'

const rowNote = (r: DemandRow): string => {
  const parts = [`${NUMBER.format(r.runs)} ${r.runs === 1 ? 'run' : 'runs'}`]
  const perRun = costPerRun(r)
  if (perRun !== null) parts.push(`${fmtUsd(perRun)}/run`)
  const cache = cacheShare(r)
  if (cache !== null) parts.push(`cache ${fmtPct(cache)}`)
  return parts.join(' · ')
}

export function WorkflowDetail({ workflow, range }: { workflow: string; range: Range }) {
  const { data: all } = useSuspenseQuery(
    usageQueries.demand({ range, by: 'workflow', payer: CREDIT_PAYERS }),
  )
  const { data: steps } = useSuspenseQuery(
    usageQueries.demand({ range, by: 'step', workflow, payer: CREDIT_PAYERS }),
  )
  const { data: models } = useSuspenseQuery(
    usageQueries.demand({ range, by: 'model', workflow, payer: CREDIT_PAYERS }),
  )
  const row = workflowRow(all, workflow)
  const noun = periodNoun(range)

  if (row === undefined) {
    return (
      <ChartCard
        title={workflow}
        placeholderHeight="content"
        state={{ empty: `${workflow} spent no credit in this range` }}
      />
    )
  }
  const segments = purposeSegments(row).map((s) => ({
    key: s.key,
    label: PURPOSE_STYLE[s.key].label,
    value: s.usd,
    color: PURPOSE_STYLE[s.key].color,
  }))
  const perRun = costPerRun(row)

  return (
    <Grid
      type="container"
      breakpoints={CONTAINER_GRID_BREAKPOINTS}
      data-shot="flow-workflow-detail"
    >
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <ChartCard
          title={`${workflow} · steps`}
          subtitle={`${fmtUsd(row.usd)} · ${rowNote(row)} · ${noun}`}
          info={STEPS_INFO}
          placeholderHeight="content"
        >
          <BarList
            label={`${workflow} cost per step, ${noun}`}
            variant="thin"
            emptyText="No steps in this range"
            format={(v) => fmtUsd(v)}
            items={steps.rows.map((r) => ({
              key: r.key,
              label: r.key,
              value: r.usd,
              secondary: (
                <Text span size="xs" c="dimmed">
                  {rowNote(r)}
                </Text>
              ),
            }))}
          />
        </ChartCard>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="md">
          <ChartCard
            title="Purpose"
            subtitle={perRun === null ? undefined : `${fmtUsd(perRun)} a run`}
            info="The workflow’s cost by what the call was for: production, verify probes and evals."
            placeholderHeight="content"
          >
            <Stack gap="xs">
              <SegmentBar segments={segments} height={10} />
              <SegmentLegend segments={segments} />
              {segments.map((s) => (
                <Text key={s.key} size="xs" c="dimmed">
                  {s.label} {fmtUsd(s.value)}
                </Text>
              ))}
            </Stack>
          </ChartCard>
          <ChartCard
            title="Models"
            subtitle={noun}
            info="The models this workflow’s credit went to."
            placeholderHeight="content"
          >
            <BarList
              label={`${workflow} cost per model, ${noun}`}
              variant="thin"
              emptyText="No models in this range"
              format={(v) => fmtUsd(v)}
              items={models.rows.map((r) => ({ key: r.key, label: r.key, value: r.usd }))}
            />
          </ChartCard>
        </Stack>
      </Grid.Col>
    </Grid>
  )
}
