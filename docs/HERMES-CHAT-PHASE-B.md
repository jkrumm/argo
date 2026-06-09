# Hermes Chat — Phase B Handover

Input for the next `/ralph setup`. Phase A (Groups 1–6, the core chat) is complete and
archived in `docs/migrations/hermes-chat-phase-a.md`. The authoritative product spec is
`docs/HERMES-CHAT-PRD.md`; the target layout is `docs/diagrams/ChatWireframe.svg`.

## Branch & prereqs

**Phase B continues on `feat/hermes-chat`** — do NOT create a new branch and do NOT merge
to `master` first. Argo is direct-to-master and solo, and Phase B's Group 9 rebuilds the
chat UI, so shipping the Phase A list+detail layout to prod now would only be replaced. The
loop commits locally and never pushes; merge to `master` once, after Phase B completes. Set
the runner to stay on the current branch (`RALPH_BRANCH=feat/hermes-chat`).

Before starting:

1. **Core-chat QA** (recommended, not blocking) — streaming, threads create/continue/switch,
   reload-restore, tool-progress chips, interrupted/error states. Streaming + DeepSeek
   titling already verified.
2. **Prod `HERMES_*`** — the Tailscale ACL `tag:vps → tag:mac :8642` is done. The remaining
   prod steps (commit the vps Hermes env in `vps/apps/argo/.env.tpl` + `compose.yml`,
   `make argo-env` + redeploy, verify `/hermes/health`) happen at MERGE time, not now —
   they don't block local Phase B development.

## Goal

Turn the working core chat into the thread-first, Slack-style assistant in the wireframe:
a feed of threads each showing a generated **title + one-line summary + type badge +
timestamp**, rich inline rendering of Hermes output (cards, diagrams, accents), voice
in/out, and attachments. The renderer primitives exist (Group 6) — Phase B makes Hermes
_emit_ them, fixes how diagrams render, rebuilds the layout, and adds audio/attachments.

## Hard constraints (non-negotiable)

- **Diagrams: NO CDN, NO iframe, NO jsDelivr.** Bundle `mermaid` + `vega-lite`, render
  inline as React components, and theme them through DESIGN.md tokens (`VX.*` CSS vars /
  Mantine). The Group 6 `diagram-frame.tsx` sandbox-iframe-loading-from-CDN approach is
  rejected and must be replaced. Contain XSS **without** the origin boundary: mermaid
  `securityLevel:'strict'`, sanitize the LLM-supplied diagram source, run Vega in
  safe/interpreter mode (no expression `eval`). (Memory: `hermes-diagram-rendering`.)
- **DESIGN.md is law.** All chrome + rendered components use Mantine v9 + the Blueprint
  palette/tokens — no raw hex (the `check-theme.mjs` guard enforces it in `bun run lint`).
  Diagram/chart colors map to the CSS-var tokens, never library defaults.
- **Argo owns the transcript; Hermes owns compressed agent state.** Don't move persistence
  into Hermes.

## Proposed groups (refine at setup)

7. **Output shaping** — get Hermes to emit the fenced `card` / `mermaid` / `vega-lite` +
   inline accent formats the renderer already supports (Hermes-side prompt/skill work +
   Argo-side validation), plus a per-thread one-line **summary** (DeepSeek, same direct
   IU-endpoint path as titling) to populate the feed rows.
8. **Diagrams done right** — bundle + theme `mermaid`/`vega-lite` inline per the hard
   constraint above; delete `diagram-frame.tsx`; the Group-1 mermaid/vega deps become used.
9. **Slack-feed layout** — rebuild the chat surface to `ChatWireframe.svg`: a thread feed
   (title + summary + type badge + timestamp + expand) and a rich composer with the attach
   menu. This is the headline.
10. **Audio + attachments** — wire `AUDIO_PROXY_*` (`/ai/v1/audio/*`): voice-record → STT in
    the composer, read-aloud (TTS) for assistant turns; text/file attachments.
11. **Usage-tracking** — record Argo's AI-call token usage (the response `usage` object) to
    the usage-tracker tagged `application=argo` (cross-repo; check its collector model first).

## Validation gate (unchanged from Phase A)

```bash
bun run lint            # includes check-theme.mjs (no raw hex / off-palette accents)
bun run format:check
bun run --cwd apps/api typecheck
bun run --cwd apps/dashboard typecheck
bun run --cwd packages/charts typecheck
bun run --cwd apps/dashboard build
bun test --cwd apps/api  # mock all upstreams; never block a group on live Hermes/audio
```

## Key references

- `docs/HERMES-CHAT-PRD.md` — authoritative product spec.
- `docs/diagrams/ChatWireframe.svg` — target layout (the Phase B headline).
- `docs/migrations/hermes-chat-phase-a.md` — what Phase A built, decisions, gotchas.
- `DESIGN.md`, `docs/MANTINE-THEMING.md`, `~/.claude/rules/visx-charts.md` — design/theming law.
- `apps/api/.claude/rules/openapi.md`, `apps/dashboard/CLAUDE.md`, `packages/charts/CLAUDE.md`.
