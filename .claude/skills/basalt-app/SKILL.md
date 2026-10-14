---
name: basalt-app
description: Scaffold, wire, verify or upgrade a basalt-ui app — `basalt-ui init`, `doctor`, `sync`, and the 1.x to 2.0 upgrade path.
when_to_use: User is adding basalt-ui to an app, wiring BasaltProvider / BasaltShell / the vite preset, upgrading basalt-ui, refreshing the shipped rules, or wiring a freshness check in CI. Also when /basalt-design reports no DESIGN.md.
---

Procedure only; the law is `.claude/rules/basalt-*.md`.

## Scaffold

1. `bun add basalt-ui && bunx basalt-ui init` (the only `bunx` call; use `./node_modules/.bin/basalt-ui` after).
2. Check the seeded `src/main.tsx` (`init` writes it when absent); `basalt-ui/styles.css` is the only stylesheet import:

```tsx
// @check
import 'basalt-ui/styles.css'
import { createRoot } from 'react-dom/client'
import { BasaltProvider, createBasaltRouter } from 'basalt-ui'
import { routeTree } from './routeTree.gen'
const router = createBasaltRouter({ routeTree })
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
createRoot(document.getElementById('root')!).render(<BasaltProvider router={router} />)
```

3. Import extension layer CSS (`@mantine/dates` for `basalt-ui/controls-dates`, `@mantine/schedule`) after `basalt-ui/styles.css` (core must precede them in `@layer mantine`).
4. Install the peers of each subpath you import: read its `Install: bun add …` line in `node_modules/basalt-ui/llms.txt`; a subpath with no `Install:` line needs only the required peers listed at the top of that file.
5. In `vite.config.ts` spread `...basaltViteConfig({ port, apiTarget })` and register, in this order, `plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), ...basaltAppPlugin({ name, description })]`. Run `bun add -d @tanstack/router-plugin` and import `tanstackRouter` from `@tanstack/router-plugin/vite`.
6. Run `vite build` once so the plugin writes `src/routeTree.gen.ts`; commit it (`tsc -b` fails without it).
7. In `src/routes/__root.tsx`: `<BasaltShell brand={{ name }} nav={NAV}><Outlet /></BasaltShell>`; build `NAV` with `defineNav` in `src/lib/nav.tsx`.
8. Add a page as a file route, and link to it with `navTarget`:

```tsx
// @check
import { Link, createFileRoute, linkOptions } from '@tanstack/react-router'
import { PageBar, defineNav, navGroup, navTarget } from 'basalt-ui'
// src/routes/dashboard.tsx — the nav item's `label` is the page name (breadcrumb); export the component too (react/only-export-components)
export const Route = createFileRoute('/dashboard')({ component: Dashboard })
export function Dashboard() {
  // a PageBar only fills slots (actions, sync, tabs, filters); the body has no title
  return <PageBar actions={[{ key: 'export', label: 'Export', primary: true }]} />
}
// src/lib/nav.tsx
export const NAV = defineNav({
  groups: [
    navGroup({ id: 'main', label: 'Main' }, [
      { id: 'dashboard', label: 'Dashboard', link: linkOptions({ to: '/dashboard' }) },
    ]),
  ],
})

// anywhere
export const ToDashboard = () => <Link {...navTarget(NAV, 'dashboard')}>Dashboard</Link>
```

9. Fill in `DESIGN.md` (identity, series dictionary, deviations).

## Add a table

A table is `BasaltDataTable` with columns from `createColumnHelper`; it has no `count` prop (with `title`, the header counts the rows itself):

```tsx
// @check
import { money } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'

type Row = { id: string; name: string; revenue: number }
const col = createColumnHelper<Row>()
const columns = [
  col.accessor('name', { header: 'Name' }),
  col.accessor('revenue', {
    header: 'Revenue',
    sortFn: 'basic', // v9 `sortFn`, not v8 `sortingFn`
    meta: { align: 'right' }, // numbers are mono-numeral by default; `numeral: false` opts out
    cell: (c) => money(c.getValue(), { currency: 'USD' }),
  }),
]
export const Revenue = ({ rows }: { rows: Row[] }) => (
  <BasaltDataTable data={rows} columns={columns} getRowId={(r) => r.id} />
)
```

## Stream a slow section

The shell holds no promise; the loader returns the slow promise unawaited (settled, so a failure renders the chart's error state), and the fallback is the same chart pending (it fills the final box):

```tsx
// @check
import { Await, createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Lines } from 'basalt-ui/charts'
import type { ChartSeries, ChartState } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
type P = { t: number; v: number }
declare const fetchPoints: () => Promise<P[]>
const series = [
  { key: 'v', label: 'Value', color: VX.accent, getValue: (p) => p.v },
] satisfies ChartSeries<P>[]
const chart = (data: P[], state: ChartState) => (
  <Lines ariaLabel="Value" data={data} x={(p) => p.t} series={series} state={state} />
)
export const Route = createFileRoute('/live')({
  loader: () => ({
    points: fetchPoints().then(
      (data) => ({ data }),
      (error: unknown) => ({ data: [], error }),
    ),
  }),
  component: Live,
})
export function Live() {
  const { points } = Route.useLoaderData()
  return (
    <Suspense fallback={chart([], { pending: true })}>
      <Await promise={points}>
        {(r) => chart(r.data, { error: r.error, empty: r.data.length === 0 })}
      </Await>
    </Suspense>
  )
}
```

## Add a chat

1. Install the `basalt-ui/agent` peers from its `Install:` line in `llms.txt`.
2. Implement `ThreadsStore` (in memory here), bind one transport per thread, compose the feed:

```tsx
// @check
import { Button } from '@mantine/core'
import { useState } from 'react'
import { ThreadFeed, ThreadFeedRow, aiSdkTransport, useAgentThreadRuns } from 'basalt-ui/agent'
import type { AgentPart, AgentThread, AgentTransport, ThreadsStore } from 'basalt-ui/agent'

type Thread = AgentThread<AgentPart>

function useMemoryStore(): ThreadsStore<AgentPart> {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, select] = useState<string | null>(null)
  const patch = (id: string, change: (t: Thread) => Thread) =>
    setThreads((all) => all.map((t) => (t.id === id ? { ...change(t), updatedAt: Date.now() } : t)))
  return {
    threads,
    activeId,
    select,
    hydrated: true,
    error: undefined,
    create: () => {
      const id = crypto.randomUUID()
      const now = Date.now()
      const blank: Thread = {
        id,
        messages: [],
        outcome: null,
        status: 'pending',
        read: true,
        createdAt: now,
        updatedAt: now,
      }
      setThreads((all) => [blank, ...all])
      return id
    },
    appendMessage: (id, m) => patch(id, (t) => ({ ...t, messages: [...t.messages, m] })),
    setOutcome: (id, outcome) => patch(id, (t) => ({ ...t, outcome })),
    setStatus: (id, status) => patch(id, (t) => ({ ...t, status })),
    setResumeToken: (id, token) =>
      patch(id, ({ resumeToken: _old, ...t }) =>
        token === undefined ? t : { ...t, resumeToken: token },
      ),
    markRead: (id) => patch(id, (t) => ({ ...t, read: true })),
    remove: (id) => {
      setThreads((all) => all.filter((t) => t.id !== id))
      select((current) => (current === id ? null : current))
    },
    clear: () => {
      setThreads([])
      select(null)
    },
  }
}

const base = aiSdkTransport<AgentPart>({ api: '/api/chat' })
// A mock (swap it in for `base.forThread(threadId)`). A text part is a DELTA: parts with the same
// `id` are appended in order.
export const mock: AgentTransport<AgentPart> = {
  async *stream(input) {
    const id = crypto.randomUUID()
    for (const word of `Echo: ${input}`.split(' ')) yield { id, type: 'text', text: `${word} ` }
  },
}

export function Chat() {
  const store = useMemoryStore()
  const { runs, start, stop } = useAgentThreadRuns({
    transport: (threadId) => base.forThread(threadId),
    store,
    resolveOutcome: (t) => ({
      title: 'Chat',
      summary: `${t.messages.length} turns`,
      status: 'done',
    }),
  })
  return (
    <>
      <Button onClick={() => store.select(store.create())}>New chat</Button>
      <ThreadFeed
        threads={store.threads}
        activeId={store.activeId}
        onSelect={store.select}
        renderRow={(t) => {
          const run = runs.get(t.id)
          const live = run === undefined ? {} : { liveParts: run.parts, liveStatus: run.status }
          return (
            <ThreadFeedRow
              key={t.id}
              thread={t}
              expanded={t.id === store.activeId}
              onToggle={() => store.select(t.id === store.activeId ? null : t.id)}
              {...live}
              onSend={({ text }) => start(t.id, text)}
              onStop={() => stop(t.id)}
            />
          )
        }}
      />
    </>
  )
}
```

3. `ThreadFeedRow` carries the `Composer`; tune it with `composerProps`.

## Verify

1. `./node_modules/.bin/basalt-ui doctor`; read to the last line. `SKIPPED` exits non-zero.
2. Fix every finding doctor prints, then rerun until it is clean.
3. `bun run lint:basalt` (`oxlint . && basalt-ui check-theme`); fix every finding at its source.
4. `bunx tsc --noEmit`; fix every error without `as never` or `any`.

## Refresh after any upgrade

1. `./node_modules/.bin/basalt-ui sync` (`--check` in CI, `--force` overwrites local edits); read its output: edited files are skipped, retired files are deleted, the AGENTS.md block is rewritten.

## Upgrade 1.x to 2.0

1. `bun add basalt-ui@latest`, then `./node_modules/.bin/basalt-ui sync`; it prunes retired managed files and rewrites the AGENTS.md block.
2. `./node_modules/.bin/basalt-ui doctor`; fix each of doctor's checks: a tsconfig that does not extend the shipped base, `basalt/*` rule ids the plugin no longer has, and imports of subpaths 2.0 dropped.
3. Work through `MIGRATING.md` § 2.0 (in the installed package): one row per removal or move; apply each that your code touches.
4. Run the Verify steps above.

## Not a React app

1. `bunx basalt-ui tokens:css --out src/tokens.css` and `bunx basalt-ui fonts:css --out src/fonts.css`.
2. Set `"basalt": { "profile": "tokens-only" }` in `package.json` by hand.
