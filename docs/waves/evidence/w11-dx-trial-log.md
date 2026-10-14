# W11 DX trial log

Route `/dx-trial` (chart + `BasaltDataTable` + `Markdown` chat card + nav entry), built from the
shipped docs only. Throwaway branch `w11-dx-trial`, never merged.

## Result

- Time-to-green: 114 s wall clock from the first command to a passing `make check` (55 s to the first
  `make check` run, which was already green). Measured with `date`; excludes model thinking time
  outside tool calls.
- `make check`: passed first try (exit 0). Warnings are pre-existing in untouched strength-tracker /
  api files; none in the new files.
- `bun run --cwd apps/dashboard build`: passed first try.
- `basalt/*` suppressions: zero. No `theme-allow`, no `as never`, no `any`.

## Wrong turns

1. **Fresh worktree has no `node_modules`.** Did: `ls node_modules/basalt-ui`. Happened: ENOENT; had to
   `bun install` before any shipped doc could be read. Should have prevented: AGENTS.md "Common
   Commands" lists `bun install` but nothing says a new worktree needs it before the docs the task
   points at exist. **ARGO-rooted** (minor; one line "worktrees need `bun install` first").
2. **"Nav entry: see `.claude/rules/basalt-state.md`" did not say where the nav lives.**
   `apps/dashboard/AGENTS.md` "Adding a page" and "Nav entry" both point at the state rule, which
   teaches `defineNav`/`navTarget` but not that Argo's `NAV` is `apps/dashboard/src/lib/nav.tsx`. Did:
   `grep -rl defineNav apps/dashboard/src` and then read the head of `nav.tsx` (an existing argo file,
   i.e. the copy-fallback the brief prohibits; I used it to find the file and the System group). The
   basalt-app skill's `src/lib/nav.tsx` would have found it, but the skill is generic. Should have
   prevented: a one-line path in dashboard AGENTS.md "Adding a page". **ARGO-rooted.**
3. **Route file shape came partly from an existing argo file.** Did: `sed -n 1,40p routes/agents.tsx`
   while looking for the route/PageBar convention, and kept `<PageBar />` + `Stack`. Happened: the
   header was visible before I tried the skill's route example, so that part is copied, not derived.
   The basalt-app skill's route example is `<h2>Dashboard</h2>`, with no `PageBar`, and no doc says
   whether a shell page needs `<PageBar />` (the mantine rule says the breadcrumb comes from the nav
   `label`, which suggests it does not). Logged as a copy-fallback. **BASALT-rooted** (skill example
   does not show the page frame a real shell page uses; `PageBar` is only in `llms.txt`'s barrel line).
4. **`state` passed to both `ChartCard` and `Lines`.** Did: `state={state}` on each. Happened: compiles
   and renders; it is redundant, since `ChartCard`'s `state` replaces its children with the placeholder.
   basalt-charts rule says "wrap in `ChartCard`; pass `state=…`" (skill step 5) but not to which; the
   streamed-section example in basalt-app puts it on the chart only. Should have prevented: one sentence
   saying which component owns `state` when wrapped. **BASALT-rooted.**
5. **`query-fn-unwrap` not exercised.** batteries rule: "Wrap every `queryFn` response in `unwrap()`".
   My mock `queryFn`s return plain data and lint was silent. Not a failure, but the rule reads as
   unconditional while the lint only fires on an API-client result; a mock-data agent cannot tell
   whether it complied. **BASALT-rooted** (low).
6. **Series colour.** Used `VX.accent` rather than registering a series in `lib/series.ts` to stay
   inside the owned-files list. The basalt-charts skill step 2 would have me edit the series file for
   any new metric; the DESIGN.md series-dictionary table says a lone metric stays neutral. Both point
   different ways for a one-series chart. **ARGO-rooted** (DESIGN.md/AGENTS.md do not say whether a
   throwaway/lone series needs a dictionary row).

## Not wrong turns (worked from docs on first try)

- `createColumnHelper` + `sortFn: 'text'|'basic'`, `enableGlobalFilter` for search, `isLoading` +
  `skeletonRows`: from the basalt-app "Add a table" section and `data-table.d.ts`.
- `Markdown streaming contentTrust="untrusted"` and the `density="chat"` prop: batteries rule + the
  `MarkdownProps` types.
- Chart: skill example + `ChartState` type; `ariaLabel` was required and typed.
- No lint finding was needed to learn a convention; no doc misled on an import path (`llms.txt`
  entry-point list was enough for `basalt-ui/{charts,table,content,tokens}`).

## Verdict

The shipped layer was enough to reach green on the first `make check`. The friction was all
navigation (where the nav and the page frame live), not basalt API. Two Argo fixes (worktree install,
nav path) and one basalt skill fix (show a real shell page, state ownership on `ChartCard`).
