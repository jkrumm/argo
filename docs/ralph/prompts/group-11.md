# Group 11: Garmin Health page

## What You're Doing

Rebuild the Garmin Health page in `apps/dashboard/src/routes/garmin-health.tsx`. The legacy is 397 lines of Refine + AntD + client-side aggregation. The new page is Mantine + TanStack + **server-computed values** from `GET /daily-metrics/summary` (cards) and `GET /daily-metrics/series` (charts). No client-side rolling averages, trend math, or PR detection — those live on the server now (Group 6).

This is the first real page migration and it locks the per-page pattern that Group 9 (Strength Tracker) follows. Take the time to get it right.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 762-770 (Group 8).
2. The **Data flow** + **Provider tree** subsections in the PRD's Architecture block.
3. Legacy page: `packages/dashboard/src/pages/garmin-health/index.tsx`. Read it fully — extract:
   - What cards exist and what fields they display.
   - What charts exist (which metric, which kind component, which zones/refLines).
   - What date-range / window controls exist.
   - Mobile layout decisions.
4. `docs/GARMIN-HEALTH.md` (spec doc — the canonical description of what this page is supposed to show).
5. The summary + series endpoints you'll consume — confirm exact response shapes from `apps/api/src/routes/daily-metrics.ts` (post Group 6).
6. `~/SourceRoot/dotfiles/rules/tanstack-router.md` — `load-use-loaders`, `load-ensure-query-data`, `search-validation`.
7. `~/SourceRoot/dotfiles/rules/tanstack-start.md` — `flow-loader-query-pattern`, `flow-suspense-query-component`.
8. `~/SourceRoot/dotfiles/rules/visx-charts.md` — chart discipline (ChartCard, ChartLegend, ChartTooltip, tokens via `useVxTheme`).
9. Mantine v9 layout components: https://mantine.dev/core/grid/, /stack/, /group/, /card/, /tabs/, https://mantine.dev/dates/date-picker/.
10. Visual parity reference: the production deploy at `https://argo.jkrumm.com` (legacy is not running locally).

---

## What to Implement

### 1. Search params schema (Zod)

```ts
const SearchSchema = z.object({
  window: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
  from:   z.string().optional(),
  to:     z.string().optional(),
  // per-metric chart toggles, if applicable
});
```

`validateSearch: zodValidator(SearchSchema)` on the route (use `@tanstack/zod-adapter` or roll a thin wrapper).

### 2. Route definition

```ts
export const Route = createFileRoute('/garmin-health')({
  validateSearch: zodValidator(SearchSchema),
  loaderDeps: ({ search }) => ({ window: search.window, from: search.from, to: search.to }),
  loader: ({ context, deps }) => Promise.all([
    context.queryClient.ensureQueryData(dailyMetricsQueries.summary(deps)),
    context.queryClient.ensureQueryData(dailyMetricsQueries.series(deps)),
  ]),
  component: GarminHealth,
});
```

### 3. Query factory

`apps/dashboard/src/lib/queries/daily-metrics.ts`:

```ts
export const dailyMetricsQueries = {
  all:     () => ['daily-metrics'] as const,
  summary: (params: WindowParams) => queryOptions({
    queryKey: [...dailyMetricsQueries.all(), 'summary', params] as const,
    queryFn: async () => unwrap(await api['daily-metrics'].summary.get({ query: params })),
  }),
  series:  (params: WindowParams) => queryOptions({
    queryKey: [...dailyMetricsQueries.all(), 'series', params] as const,
    queryFn: async () => unwrap(await api['daily-metrics'].series.get({ query: params })),
  }),
};
```

`unwrap` is a tiny helper that throws on `error` and returns `data` — put it in `apps/dashboard/src/lib/eden.ts` alongside the treaty client.

### 4. Component composition

```
<Stack>
  <Group justify="space-between">
    <Title>Garmin Health</Title>
    <Group>
      <SegmentedControl value={window} onChange={…} data={['7d','30d','90d','all']} />
      <DatePickerInput type="range" value={[from, to]} onChange={…} />
    </Group>
  </Group>

  <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
    <SummaryCard metric="hrv"        summary={summary.hrv} />
    <SummaryCard metric="restingHr"  summary={summary.restingHr} />
    <SummaryCard metric="sleep"      summary={summary.sleep} />
    <SummaryCard metric="stress"     summary={summary.stress} />
  </SimpleGrid>

  <Grid>
    <Grid.Col span={{ base: 12, lg: 6 }}><HrvChart points={series.points} /></Grid.Col>
    <Grid.Col span={{ base: 12, lg: 6 }}><RestingHrChart points={series.points} /></Grid.Col>
    {/* …sleep, stress */}
  </Grid>
</Stack>
```

`SummaryCard` displays `current`, `ma7`, `ma30`, and a trend indicator (`'up' | 'down' | 'flat'` from the server). Use `IconTrendingUp`/`Down`/`Minus` from `@tabler/icons-react` and the `VX.good`/`VX.bad`/`VX.warn` tokens (via a non-chart consumer — these tokens are theme-agnostic and exported from `@argo/charts`, so importing them in a Mantine card is allowed; the only ban is the reverse direction).

Charts compose `@argo/charts` primitives via the `ChartCard` + `ChartLegend` + `ChartTooltip` discipline. Reference the existing legacy charts for which kinds + zones to use per metric. Sparklines from `@argo/charts/sparklines` go inside the summary cards if the legacy page used them.

### 5. Loading + error states

- Loading: TanStack Router shows the route loader spinner; per-component `useSuspenseQuery` is wrapped in a Suspense boundary in `__root.tsx` already.
- Error: per-route `errorComponent` shows the message + a retry button (`queryClient.invalidateQueries({ queryKey: dailyMetricsQueries.all() })`).

### 6. Search-param URL sync

Window/from/to changes update the URL via `useNavigate({ search: (prev) => ({ …prev, window: '7d' }) })` — see `nav-use-navigate` rule. Loader picks up the change automatically because `loaderDeps` includes them.

### 7. No client-side aggregation

Grep your code after writing: it should contain **zero** rolling-average / mean / trend / PR logic. If the legacy did math on the client, that math is on the server now. If a number you need is not in the summary response, either add it to the summary endpoint in this group (small additive change to `apps/api/src/routes/daily-metrics.ts`) or push the calc out and consume `series.points` if a single-pass derivation is unavoidable.

---

## Validation

```bash
bun install
bun --cwd apps/dashboard typecheck
bun --cwd apps/dashboard build
bun run lint
bun run format:check

# Manual:
make db-up || docker compose -f apps/api/docker-compose.dev.yml up -d
bun --cwd apps/api db:migrate
bun --cwd apps/api start &
bun --cwd apps/dashboard dev &
# Visit http://localhost:5173/garmin-health — visual parity vs https://argo.jkrumm.com
```

Verify:
- Cards show the same `current` / `ma7` / `ma30` / trend as production.
- Charts render in both light and dark; theme toggle propagates without reload.
- `window=7d|30d|90d|all` switches data correctly.
- Date range picker works.
- Mobile breakpoint stacks correctly.
- HyperDX shows a single trace per page load that crosses browser → api.
- No client-side aggregation: `grep -E '(rolling|movingAvg|trend)' apps/dashboard/src/routes/garmin-health.tsx` returns nothing meaningful.

---

## Commit

```
feat(dashboard): rebuild garmin-health page on mantine + tanstack + server summaries
```

If you needed to add fields to the summary endpoint, that's a separate `feat(api): …` commit.

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 11
```
