# Group 6: Smart cards + rich rendering

## What You're Doing

Upgrade `MessageMarkdown` from base markdown to the full rich renderer: fenced
` ```card ` blocks become Mantine cards, ` ```mermaid ` / ` ```vega-lite ` render in
a sandboxed iframe, inline directives become accents, and tool-progress shows as
chips. This completes Phase A — a polished core chat.

## Research & Exploration First

1. Re-read `docs/HERMES-CHAT-PRD.md` → Rendering + Security (sandboxing) +
   "E2E validation" (cards live in markdown, not separately persisted).
2. Verify APIs: overriding `react-markdown` code-block rendering by language;
   `remark-directive` v3 mapping (`unist-util-visit`) for `:badge[…]` / `==highlight==`;
   `mermaid` render API; `vega-embed`; `rehype-harden` + `rehype-sanitize` config.
   Confirm Mermaid/Vega XSS sandboxing (iframe `sandbox="allow-scripts"`, no
   `allow-same-origin`, via `srcdoc`).
3. Read `packages/charts` token approach + `DESIGN.md` for theming the diagrams.

## What to Implement

### 1. Smart card renderer

Override the code-block renderer: when language is `card`, parse the JSON, switch on
`type` (`infra` → status card with ok/warn/err, `todo` → task card, `note` →
titled card; reserve `audio` for Phase B) → Mantine components themed to DESIGN.md.
**Invalid/partial JSON → graceful `<Code>` fallback (never throw).** Streaming
safety comes from `remend` (already deferring incomplete fences) — verify a
half-streamed ` ```card ` doesn't flash broken.

### 2. Diagrams / charts (sandboxed)

`mermaid` and `vega-lite` code blocks → render inside a sandboxed
`<iframe sandbox="allow-scripts">` via `srcdoc` (no same-origin). Theme to DESIGN.md
CSS-var tokens. Defer until the closing fence (rely on `remend`).

### 3. Inline accents

`remark-directive` for `:badge[…]` and `==highlight==` → small Mantine components.

### 4. Security + progress

Add `rehype-harden` + `rehype-sanitize` to the markdown pipeline for all LLM output.
Render `data-toolProgress` transient parts as transient chips during a run.

## Validation

```bash
bun run lint && bun run format:check
bun run --cwd apps/api typecheck && bun run --cwd apps/dashboard typecheck && bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
```

Acceptance: a message containing ` ```card ` (infra) + ` ```card ` (todo) +
` ```mermaid ` + ` ```vega-lite ` renders correctly, **without mid-stream breakage**,
with Mermaid/Vega **sandboxed**; invalid card JSON degrades to a code block.

## Commit

```
feat(hermes-chat): smart cards, sandboxed mermaid/vega, inline directives, progress chips
```

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`. Phase A is complete — note in
the file that the next step is manual QA then Phase B (Groups 7–10). Then:

```
RALPH_TASK_COMPLETE: Group 6
```
