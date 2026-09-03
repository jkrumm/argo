---
paths:
  - apps/dashboard/**
---

# TanStack Router — Argo Deltas

Delta over `.claude/rules/basalt-state.md` — everything else about search stores lives there.

- Hand-written navigates (routes with composed keys, e.g. `astro-window.tsx`'s `detailDate`/map
  layers) spread the CURRENT search, not the reducer form — TanStack types `prev` as the union of
  every route's search, so `(prev) => …` won't typecheck. This contradicts basalt-state.md's
  reducer advice for multi-route apps; argo's form wins here.
- Every store-issued navigate carries `resetScroll: false` — never add it by hand.
- `field.range.toWindow(v)` is the ONLY window→params projection (preset → `{ window }`, custom →
  `{ from, to }`). Presets the API refuses (`3m`/`6m`/`1y`/`ytd`) declare a `window:` resolver on
  the field and come back as `{ from, to }`, dropped from the `{ window }` branch — no cast needed.
  `toApiWindow(resolved, fallback)` in `lib/window-stores.ts` folds the one unreachable
  `custom: true` guard onto the API default.
- Define `loaderDeps` whenever the loader depends on search params — without it, changes don't
  re-trigger the loader. Use `ensureQueryData` (not `fetchQuery`) so cached data is reused.

`src/routeTree.gen.ts` is auto-generated — never edit it (`tsr generate`, also runs in
`typecheck`). File names starting with `__` are reserved by the generator; only `__root.tsx` is
valid.
