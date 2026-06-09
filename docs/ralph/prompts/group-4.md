# Group 4: Diagrams II — vega-lite bundled + retire iframe

## What You're Doing

Replace the CDN/iframe vega path with a **bundled, inline React component** that renders
Vega-Lite specs using the already-installed `vega` + `vega-lite` packages in **safe /
interpreter mode (no expression `eval`)**, themed via `--vx-*` tokens. Then **delete
`diagram-frame.tsx` + its CSS** — the iframe/CDN renderer is fully retired. The installed
diagram deps become used; remove any now-unused dep (e.g. `vega-embed`) per dependency
hygiene.

> **Hard constraint:** NO CDN, NO iframe, NO jsDelivr. Vega runs in safe mode (no `Function`/
> `eval` for expressions). Sanitize the LLM-supplied spec. See shared context.

---

## Research & Exploration First

1. `apps/dashboard/src/features/hermes-chat/diagram-frame.tsx` — the vega branch: how it
   builds a `config` from `--vx-*` series colors + categorical range, `renderer: 'svg'`,
   `actions: false`. **Reuse the config logic, drop the iframe + vega-embed.**
2. Research the **CSP-safe Vega path** (Context7/Tavily): `vega-lite` `compile(spec).spec`
   → `vega.parse(vgSpec)` → `new vega.View(runtime, { renderer: 'svg' })`; and the
   **expression interpreter** (`vega-interpreter` / `expr` option) so no `Function`/`eval` is
   used. Confirm whether `vega-interpreter` is already installed — **if a new dep is needed,
   flag it in RALPH_NOTES** and prefer the smallest CSP-safe option; do not add a heavy dep
   casually.
3. `message-markdown.tsx` — the `lang === 'vega-lite'` branch (still on `DiagramFrame` after
   Group 3).
4. Group 3's `mermaid-diagram.tsx` — match its theming + error-fallback + debounce shape.
5. `grep -rn "diagram-frame" apps/dashboard/src` — find every importer before deleting.

---

## What to Implement

### 1. `vega-lite-diagram.tsx`

```tsx
export function VegaLiteDiagram({ source }: { source: string }): JSX.Element
```

- Parse the source as JSON defensively (try/catch → themed error fallback + raw `<Code
block>`). **Sanitize the spec**: reject/strip anything that could load remote data or
  execute (e.g. `data.url`, signals with arbitrary expressions) — render only inline-data
  specs; document the policy in RALPH_NOTES.
- `vega-lite` `compile()` → `vega.parse()` → `vega.View` with the **interpreter** expression
  evaluator (no `eval`), `renderer: 'svg'`, `actions: false`. Apply the `--vx-*`-derived theme
  config + categorical range. Re-render on color-scheme change + debounced source.
- Destroy the `View` (`view.finalize()`) on unmount / re-render to avoid leaks.

### 2. Wire + retire

- `message-markdown.tsx`: `lang === 'vega-lite'` → `<VegaLiteDiagram source={...} />`.
- **Delete** `diagram-frame.tsx` and `diagram-frame.module.css`. Confirm zero remaining
  imports.
- If `vega-embed` is no longer imported anywhere, remove it from `apps/dashboard/package.json`
  (and the lockfile) — keep `vega` + `vega-lite` (+ interpreter if added).

---

## Validation

```bash
bun run --cwd apps/dashboard typecheck
bun run lint && bun run format:check
bun run --cwd apps/dashboard build
grep -rn "diagram-frame\|jsdelivr\|cdn.jsdelivr" apps/dashboard/src || echo "clean: no CDN/iframe refs"
```

Manual-QA notes: a valid vega-lite bar/line spec renders inline & themed; light/dark
re-themes; a spec with `data.url` is rejected safely; malformed JSON shows the fallback;
confirm **no jsDelivr request** and **no CSP eval**.

---

## Commit

```
feat(hermes-chat): bundled inline vega-lite (safe mode); remove CDN/iframe renderer
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 4
```
