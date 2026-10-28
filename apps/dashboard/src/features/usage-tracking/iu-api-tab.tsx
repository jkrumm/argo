/**
 * The expert view of the IU API, the metered lane (different use, so its own tab). The Key control
 * scopes the whole tab to one API key or, on All, to both: each key has its own rolling 30-day cap, so
 * All shows one cap meter per key side by side and never a summed one; the records views (figures,
 * charts, lists) add the keys up. Per key: the cap meter, the portal-vs-tracked strip; for the scope:
 * how much of the spend carries no project, figures, spend over time, the weekly rhythm, the ranked
 * projects, tools and models, and where the tokens go and what they cost.
 */
import { Suspense, type ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import {
  USAGE_IU_KEY_VALUES,
  usageStore,
  type UsageGroupBy,
  type UsageIuKey,
  type UsageLens,
} from '../../lib/window-stores'
import type { KeyWallet } from './accounts'
import CacheEfficiency from './cache-efficiency'
import { WalletMeter, useKeyBudget } from './limits'
import { fmtShare, fmtUsdWhole, periodNoun } from './model'
import { OverTime } from './over-time'
import { pickOptions } from './pick-options'
import RankedList from './ranked-list'
import Reconciliation from './reconciliation'
import { Rhythm } from './rhythm'
import { iuKeyScope, selectedKeyWallets, type PayerScope } from './scope'
import { SPLIT_TOP, combinedTotal, unsetShare } from './split-model'
import TopSpenders from './top-spenders'
import type { WorkspaceValue } from './types'
import classes from './usage.module.css'
import { WalletFigures } from './wallet-figures'

const GROUP_OPTIONS: readonly UsageGroupBy[] = ['sub_tool', 'model_norm', 'project']

const limitsInfo = (wallet: KeyWallet, reported: boolean): string =>
  reported
    ? `${wallet.label} key spend over the rolling 30 days against the key's own $500 cap, from the IU portal report; the tick marks 80 %. The ink turns at 80 % and 100 %.`
    : `The ${wallet.label} key's cap is read from IU's portal report, which has not arrived yet: until it does, only the spend tracked so far is shown, never a meter.`

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

/** How much of the range's spend no project can be named for: the attribution gap. */
function ProjectCoverage({
  scope,
  range,
  workspace,
}: {
  scope: PayerScope
  range: Range
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.split({
      by: 'project',
      range,
      lens: 'cost',
      payer: scope.payers,
      workspace,
      top: SPLIT_TOP,
    }),
  )
  const gap =
    shotState() === 'empty'
      ? null
      : unsetShare(query.data.rows, combinedTotal(query.data.totals, scope.payers))
  if (gap === null) return null
  const spend = scope.id === 'iu-keys' ? 'IU API spend across both keys' : `${scope.title} spend`
  return (
    <Text size="sm" c="dimmed" data-shot={`project-coverage-${scope.id}`} data-shot-absent="empty">
      {gap.cost <= 0
        ? `Every dollar of ${spend} carries a project · ${periodNoun(range)}`
        : `${fmtShare(gap.share)} of ${spend} has no project (${fmtUsdWhole(gap.cost)}) · ${periodNoun(range)}`}
    </Text>
  )
}

/** One key's cap: its own meter, can-spend-today and freshness, in a card of its own. */
function KeyLimit({ wallet, children }: { wallet: KeyWallet; children?: ReactNode }) {
  const { missing } = useKeyBudget(wallet)
  return (
    <Box data-shot={`limit-${wallet.id}`} h="100%">
      <ChartCard
        className={classes.fill}
        title={`Limit · ${wallet.label} · ${withUnit('rolling 30', 'd')}`}
        info={limitsInfo(wallet, !missing)}
        placeholderHeight="content"
      >
        <Stack gap="sm">
          <WalletMeter wallet={wallet} heading="none" />
          {children}
        </Stack>
      </ChartCard>
    </Box>
  )
}

export function IuApiTab({
  iuKey,
  range,
  grain,
  lens,
  groupBy,
  workspace,
}: {
  iuKey: UsageIuKey
  range: Range
  grain: Grain
  lens: UsageLens
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
}) {
  const scope = iuKeyScope(iuKey)
  const wallets = selectedKeyWallets(iuKey)
  const several = wallets.length > 1
  const coverage = (
    <Suspense fallback={null}>
      <ProjectCoverage scope={scope} range={range} workspace={workspace} />
    </Suspense>
  )

  return (
    <Section
      title="IU API"
      tabs={
        <ViewTabs
          field={usageStore.field.iuKey}
          options={pickOptions<UsageIuKey>(usageStore.field.iuKey.options, USAGE_IU_KEY_VALUES)}
          label="Key"
        />
      }
    >
      <Stack gap="md">
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          {wallets.map((wallet) => (
            <Grid.Col key={wallet.id} span={{ base: 12, lg: 12 / wallets.length }}>
              <KeyLimit wallet={wallet}>{several ? null : coverage}</KeyLimit>
            </Grid.Col>
          ))}
        </Grid>
        {several ? (
          <Stack gap={4}>
            {coverage}
            <Text size="sm" c="dimmed">
              Each key has its own cap. Everything below adds both keys up.
            </Text>
          </Stack>
        ) : null}
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          {wallets.map((wallet) => (
            <Grid.Col key={wallet.id} span={{ base: 12, lg: 12 / wallets.length }}>
              <Suspense fallback={fallback(200)}>
                <Reconciliation wallet={wallet} named={several} />
              </Suspense>
            </Grid.Col>
          ))}
        </Grid>
        <Suspense fallback={fallback(120)}>
          <WalletFigures scope={scope} range={range} workspace={workspace} />
        </Suspense>
        <Suspense fallback={fallback(300)}>
          <OverTime
            range={range}
            grain={grain}
            lens={lens}
            scope={scope}
            groupBy={groupBy === 'payer' ? 'sub_tool' : groupBy}
            groupOptions={GROUP_OPTIONS}
            workspace={workspace}
          />
        </Suspense>
        <Suspense fallback={fallback(240)}>
          <Rhythm scope={scope} range={range} lens={lens} workspace={workspace} />
        </Suspense>
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          {(['project', 'sub_tool', 'model_norm'] as const).map((by) => (
            <Grid.Col key={by} span={{ base: 12, lg: 4 }}>
              <Suspense fallback={fallback(320)}>
                <RankedList by={by} scope={scope} range={range} lens={lens} workspace={workspace} />
              </Suspense>
            </Grid.Col>
          ))}
        </Grid>
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={fallback(260)}>
              <TopSpenders range={range} lens={lens} payers={scope.payers} workspace={workspace} />
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={fallback(260)}>
              <CacheEfficiency
                range={range}
                lens={lens}
                payers={scope.payers}
                workspace={workspace}
              />
            </Suspense>
          </Grid.Col>
        </Grid>
      </Stack>
    </Section>
  )
}
