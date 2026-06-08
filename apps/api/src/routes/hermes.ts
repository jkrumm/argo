import { Elysia } from 'elysia'
import { z } from 'zod'

// Hermes Chat — thread-first chat surface backed by the Hermes agent core over
// its OpenAI-compatible API. Argo owns the verbatim transcript (hermes_thread +
// hermes_message); Hermes owns compressed agent state per session id.
//
// Group 1 ships a single health stub only — no behavior. The real handlers land
// in later groups:
//   • Group 2 — POST /hermes/chat (AI SDK UIMessageStream proxy + persistence)
//   • Group 4 — thread/message read CRUD + DeepSeek auto-titling
//   • Group 8 — GET /hermes/audio (range proxy with tailnet allowlist)
// See docs/HERMES-CHAT-PRD.md.

export const hermesRoutes = new Elysia({ prefix: '/hermes' }).get(
  '/health',
  () => ({ status: 'ok' as const }),
  {
    response: z.object({ status: z.literal('ok') }),
    detail: {
      tags: ['Hermes Chat'],
      summary: 'Hermes Chat proxy liveness',
      description:
        'Returns `{ status: "ok" }` if the Hermes Chat route module is mounted. This is a static liveness stub — it does NOT reach the upstream Hermes agent core. Real chat streaming (POST /hermes/chat), thread/message reads, and the audio range proxy land in later groups; use this only to confirm the module is wired.',
      security: [{ BearerAuth: [] }],
    },
  },
)
