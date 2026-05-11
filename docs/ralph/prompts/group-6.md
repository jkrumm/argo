# Group 6: Extract visx to `packages/charts`

## What You're Doing

Create a new `packages/charts` workspace (`@argo/charts`) that holds the visx primitives, kind components, sparklines, hooks, tokens, and the theme provider. The package is **theme-agnostic** — no Mantine imports, no `apps/**` imports. Mantine's color scheme reaches into it only through `apps/dashboard/src/charts-bridge.tsx`, which is the single bridge file.

**Copy, don't move.** Legacy `packages/dashboard/src/charts/` stays untouched until Group 11's prune step — the legacy build keeps working.

This group can run in parallel with Group 4.

---

## Required Reading

1. **The PRD section** for this group: `docs/MANTINE-MIGRATION-PRD.md` lines 666-686 (Group 5).
2. The **`@argo/charts` boundary rules** subsection in the PRD's Architecture block.
3. The current chart code: `packages/dashboard/src/charts/{primitives,kinds,sparklines,hooks,utils,tokens.ts,theme.tsx,hover-context.ts,index.ts}`.
4. `~/SourceRoot/dotfiles/rules/visx-charts.md` — the chart discipline rule (update its import examples to reference `@argo/charts` as part of this group).
5. visx docs only if you need to verify a specific primitive's current API surface.

---

## What to Implement

### 1. `packages/charts/package.json`

```json
{
  "name": "@argo/charts",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "dependencies": {
    "@visx/...": "<copy from legacy>"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Move `@visx/*` deps from `packages/dashboard/package.json` to `packages/charts/package.json` — but **leave them present in the legacy** as well (workspace hoisting handles dedup). Easiest: duplicate the deps for now; Group 11 prune cleans the legacy.

### 2. `packages/charts/tsconfig.json`

`strict: true`, `jsx: "react-jsx"`, `moduleResolution: "bundler"`, `composite: true` if you want project references. Output `dist/` is not required (the package is consumed via source through the path alias).

### 3. Source extraction (copy, don't move)

Copy the following from `packages/dashboard/src/charts/` → `packages/charts/src/`:

- `primitives/` (entire subtree)
- `kinds/`
- `sparklines/`
- `hooks/`
- `utils/`
- `tokens.ts`
- `theme.tsx` (will be rewritten — see below)
- `hover-context.ts`
- `index.ts` (barrel; ensure exports are explicit, not wildcard)

### 4. Rewrite `packages/charts/src/theme.tsx`

```ts
'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { VX } from './tokens';

type ColorScheme = 'light' | 'dark';

type VxTheme = {
  colorScheme: ColorScheme;
  // resolved per-theme neutrals (line, axis, tooltip bg/text, …)
  line: string;
  axis: string;
  tooltipBg: string;
  tooltipText: string;
  // …whatever theme-dependent fields existed before
};

const VxThemeContext = createContext<VxTheme | null>(null);

export function VxThemeProvider({
  colorScheme,
  children,
}: {
  colorScheme: ColorScheme;
  children: ReactNode;
}) {
  const value = useMemo<VxTheme>(() => {
    const isDark = colorScheme === 'dark';
    return {
      colorScheme,
      line: isDark ? VX.lineDark : VX.lineLight,
      axis: isDark ? VX.axisDark : VX.axisLight,
      tooltipBg: isDark ? VX.tooltipBgDark : VX.tooltipBgLight,
      tooltipText: isDark ? VX.tooltipTextDark : VX.tooltipTextLight,
    };
  }, [colorScheme]);
  return <VxThemeContext.Provider value={value}>{children}</VxThemeContext.Provider>;
}

export function useVxTheme(): VxTheme {
  const ctx = useContext(VxThemeContext);
  if (!ctx) throw new Error('useVxTheme must be used inside <VxThemeProvider>');
  return ctx;
}
```

**Strict rule:** no `@mantine/*` import in any file under `packages/charts/src/**`. No `apps/**` import. No `localStorage.getItem('theme')`. The lint config in Group 10 enforces this; for now, enforce it manually and grep before committing.

### 5. Tokens

Keep `VX.{good,bad,warn,…}` and `VX.series.{hrv,restingHr,…}` direct on `VX` (theme-agnostic). Add `VX.{lineDark,lineLight,axisDark,axisLight,tooltipBgDark,…}` pairs that `useVxTheme` resolves.

### 6. `apps/dashboard/src/charts-bridge.tsx`

```ts
'use client';
import { useMantineColorScheme } from '@mantine/core';
import { VxThemeProvider } from '@argo/charts';
import type { ReactNode } from 'react';

export function VxBridge({ children }: { children: ReactNode }) {
  const { colorScheme } = useMantineColorScheme();
  const resolved = colorScheme === 'auto' ? 'dark' : colorScheme; // pick a deterministic default
  return <VxThemeProvider colorScheme={resolved}>{children}</VxThemeProvider>;
}
```

Wire `<VxBridge>` in `main.tsx` between `MantineProvider` and `QueryClientProvider`.

### 7. oxlint override for `packages/charts/src/**`

Add to `.oxlintrc.json` overrides:

```json
{
  "files": ["packages/charts/src/**"],
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["@mantine/*"], "message": "@argo/charts must be theme-agnostic" },
        { "group": ["apps/*", "../../apps/*", "../apps/*"], "message": "@argo/charts must not import from apps/*" }
      ]
    }]
  }
}
```

Verify `bun run lint` is clean.

### 8. Smoke route

Wire a temporary route (e.g. `apps/dashboard/src/routes/__charts-smoke.tsx`) that renders one primitive, one kind, and one sparkline. Toggle theme — confirm all three update without reload. Delete the smoke route after the visual verification (or leave it gated on `import.meta.env.DEV`).

### 9. Update `~/SourceRoot/dotfiles/rules/visx-charts.md`

Where the rule references chart-package import paths, point at `@argo/charts`. Commit the dotfiles change separately.

---

## Validation

```bash
bun install
bun --cwd packages/charts typecheck
bun --cwd apps/dashboard typecheck
bun --cwd apps/dashboard build
bun run lint
bun run format:check

# Verify no banned imports leak:
grep -rE "from '@mantine/" packages/charts/src/  # must be empty
grep -rE "from '\.\./\.\./apps/" packages/charts/src/  # must be empty
```

Legacy build must still work — confirm `bun --cwd packages/dashboard build` succeeds (its local `charts/` copy is untouched).

---

## Commit

```
refactor(charts): extract visx primitives into @argo/charts (theme-agnostic)
```

The dotfiles rule update is a separate commit in `~/SourceRoot/dotfiles`:

```
docs(rules): point visx-charts examples at @argo/charts
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then output as the literal last line:

```
RALPH_TASK_COMPLETE: Group 6
```
