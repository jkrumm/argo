# Group 3: Diagrams I — mermaid bundled + themed

## What You're Doing

Replace the CDN/iframe mermaid path with a **bundled, inline React component** that renders
mermaid diagrams using the already-installed `mermaid@11.15.0` package, themed via the
`--vx-*` / Mantine tokens, reactive to color scheme, with XSS contained **without** the
iframe origin boundary. Route the renderer's ` ```mermaid ` fence to the new component. Leave
the vega-lite path on `diagram-frame.tsx` for now (Group 4 finishes the retirement).

> **Hard constraint:** NO CDN, NO iframe, NO jsDelivr. Bundle the local package. mermaid
> `securityLevel: 'strict'`, sanitize the source. See shared context.

---

## Research & Exploration First

1. `apps/dashboard/src/features/hermes-chat/diagram-frame.tsx` — how it currently reads theme
   colors (`getComputedStyle` of `--vx-*` / `--mantine-color-*`), the mermaid config
   (`securityLevel: 'strict'`, `theme: 'base'`, `themeVariables`), the 250ms source debounce,
   and the color-scheme reactivity. **Reuse this logic, drop the iframe.**
2. `mermaid@11` API — research via Context7/Tavily: `mermaid.initialize(config)` +
   `await mermaid.render(id, source)` → `{ svg, bindFunctions }`. Confirm `securityLevel:
'strict'` behavior and built-in DOMPurify sanitization in v11.
3. `apps/dashboard/src/features/hermes-chat/message-markdown.tsx` — the `code` component
   (~lines 106–134) that dispatches `lang === 'mermaid'` → `<DiagramFrame kind="mermaid">`.
4. `packages/charts/src/tokens.ts` + `theme-vars.ts` — the `--vx-*` series vars
   (hrv/restingHr/calories/vo2max/squat/spo2) + `useMantineColorScheme` for reactivity.
5. `DESIGN.md` + `docs/MANTINE-THEMING.md` — color discipline (no raw hex).

---

## What to Implement

### 1. `mermaid-diagram.tsx`

```tsx
export function MermaidDiagram({ source }: { source: string }): JSX.Element
```

- `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base',
themeVariables: <from --vx-* / mantine colors> })`. Re-initialize + re-render on color-scheme
  change (`useMantineColorScheme`) and on debounced source change.
- `await mermaid.render(uniqueId, source)`; render the returned SVG inline (no iframe). Even
  with `securityLevel: 'strict'`, treat the SVG defensively — render via a sanitized path
  (mermaid's strict mode sanitizes; do not introduce a new dependency casually — prefer the
  built-in). Wrap parse/render in try/catch → show a themed error fallback + a `<Code block>`
  of the raw source (mirror the SmartCard invalid fallback).
- Debounce streaming source (~250ms) so partial fences don't thrash the parser.
- No raw hex anywhere — colors from tokens/CSS vars only.

### 2. Wire the renderer

In `message-markdown.tsx`, change the `lang === 'mermaid'` branch to render `<MermaidDiagram
source={...} />`. Keep `lang === 'vega-lite'` on `DiagramFrame` (removed in Group 4).

---

## Validation

```bash
bun run --cwd apps/dashboard typecheck
bun run lint && bun run format:check    # check-theme.mjs must pass (no raw hex)
bun run --cwd apps/dashboard build
```

Manual-QA notes in RALPH_NOTES (no dashboard test harness): a valid flowchart renders inline
& themed; light/dark toggle re-themes; a malformed diagram shows the fallback, not a crash;
confirm **no network request to jsDelivr** for mermaid.

---

## Commit

```
feat(hermes-chat): bundled inline mermaid rendering, themed + strict
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:

```
RALPH_TASK_COMPLETE: Group 3
```
