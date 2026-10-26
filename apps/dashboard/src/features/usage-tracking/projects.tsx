/**
 * Section E, projects: the ten biggest normalized projects plus Other, following the lens (spend, or
 * fresh tokens: the breakdown API's `tokens` leaves cache-read out). Max projects only appear under
 * `+ subscriptions`, as list value. The API's `(unset)` bucket reads `(no project)`. The breakdown
 * carries no workspace, so rows have no workspace tag.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import type { UsageLens, UsageScope } from '../../lib/window-stores'
import { scopePayers } from './budget-model'
import {
  OTHER_KEY,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  noDataInWindow,
  periodNoun,
  tokensFormatterFor,
  SPEND_NOUN,
} from './model'
import type { WorkspaceValue } from './types'

const PROJECT_LIMIT = 10
const UNSET_KEY = '(unset)'
const NO_PROJECT = '(no project)'

const INFO =
  'The projects that account for the most, normalized from the working directory, plus the rest as Other. Tokens are fresh tokens: cache-read is left out. Under + subscriptions the Max projects join, as list value.'

export default function Projects({
  range,
  lens,
  scope,
  workspace,
}: {
  range: Range
  lens: UsageLens
  scope: UsageScope
  workspace: WorkspaceValue[] | undefined
}) {
  const spend = lens === 'spend'
  const payer = scopePayers(scope)
  const query = useSuspenseQuery(
    usageQueries.breakdown({
      range,
      metric: spend ? 'cost' : 'tokens',
      dimension: 'project',
      limit: PROJECT_LIMIT,
      payer,
      workspace,
    }),
  )
  const data = shotState() === 'empty' ? { ...query.data, rows: [], total: 0 } : query.data
  const shown = data.rows.reduce((sum, r) => sum + r.value, 0)
  const rest = Math.max(0, data.total - shown)
  const items = data.rows.map((r) => ({
    key: r.key,
    label: r.key === UNSET_KEY ? NO_PROJECT : r.key,
    value: r.value,
    secondary: fmtShare(r.share),
  }))
  if (rest > (spend ? 0.5 : 0)) {
    items.push({
      key: OTHER_KEY,
      label: OTHER_KEY,
      value: rest,
      secondary: fmtShare(data.total > 0 ? rest / data.total : null),
    })
  }
  const peak = items.reduce((max, i) => Math.max(max, i.value), 0)
  const emptyText = noDataInWindow('project usage', range)

  return (
    <Box data-shot="projects" data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`Projects · ${periodNoun(range)}`}
        info={INFO}
        facts={
          spend
            ? { value: fmtUsdWhole(data.total), period: SPEND_NOUN[scope] }
            : { value: fmtTokens(data.total), period: 'fresh tokens' }
        }
        {...(scope === 'all' ? { subtitle: 'Includes subscriptions at list value' } : {})}
        state={{ empty: (items.length === 0 || data.total <= 0) && emptyText }}
      >
        <BarList
          label={`Top ${data.rows.length} projects by ${spend ? 'spend' : 'fresh tokens'}, ${periodNoun(range)}`}
          format={spend ? fmtUsdWhole : tokensFormatterFor(peak)}
          variant="thin"
          items={items}
        />
      </ChartCard>
    </Box>
  )
}
