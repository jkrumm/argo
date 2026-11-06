import { createFileRoute } from '@tanstack/react-router'
import { AgentPerformancePage } from '../features/agent-performance/agent-performance-page'
import { agentPerformanceQueries } from '../lib/queries/agent-performance'
import { agentPerfStore } from '../lib/window-stores'

export const Route = createFileRoute('/agent-performance')({
  validateSearch: agentPerfStore.validateSearch,
  loaderDeps: ({ search }) => ({ weeks: search.weeks }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(agentPerformanceQueries.usage(deps.weeks)),
  component: AgentPerformancePage,
})
