// theme-allow-file in-body-page-title — dev-only chart smoke route: it is not a nav destination,
// has no breadcrumb of its own, and the <Title order={2}> IS its only name.
import { createFileRoute } from '@tanstack/react-router'
import { Box, Title } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'

export const Route = createFileRoute('/charts-smoke')({
  component: ChartsSmokeRoute,
})

// MIGRATION-STUB(w7): the 1.x smoke fixtures (ChartLegend, LineSparkline, ZonedLine, MultiLine) are
// gone from 2.0; Wave 7 rebuilds this route on `Lines` / `Sparkline` (docs/waves/PLAN.md).
function ChartsSmokeRoute() {
  if (!import.meta.env.DEV) return null

  return (
    <Box p={24} maw={800}>
      <Title order={2} mb="md">
        basalt-ui/charts smoke test
      </Title>
      <ChartCard title="Smoke" state={{ empty: 'Migrating to basalt-ui 2.0' }} />
    </Box>
  )
}
