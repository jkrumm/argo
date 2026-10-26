/**
 * The IU API in detail, collapsed on load: where its tokens go (tool · model), what they cost per
 * million with how much is cache-read, and whether the portal's own bill agrees with what we track.
 * Always the IU API payer: the page scope does not apply here. The body, and its queries, mount only
 * once the reader opens the section.
 */
import { Suspense } from 'react'
import { Box, Grid, Stack } from '@mantine/core'
import { Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import type { Range } from '../../lib/queries/usage'
import { periodNoun } from './model'
import type { WorkspaceValue } from './types'
import CacheEfficiency from './cache-efficiency'
import Reconciliation from './reconciliation'
import TopSpenders from './top-spenders'

export default function IuDetail({
  range,
  lens,
  workspace,
}: {
  range: Range
  lens: 'spend' | 'tokens'
  workspace: WorkspaceValue[] | undefined
}) {
  const sections = { range, lens, scope: 'iu-api', workspace } as const
  return (
    <Box data-shot="iu-detail">
      <Section title={`IU API detail · ${periodNoun(range)}`} collapsible defaultOpen={false}>
        <Stack gap="md">
          <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={260} />}>
                <TopSpenders {...sections} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={260} />}>
                <CacheEfficiency {...sections} />
              </Suspense>
            </Grid.Col>
          </Grid>
          <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={200} />}>
            <Reconciliation />
          </Suspense>
        </Stack>
      </Section>
    </Box>
  )
}
