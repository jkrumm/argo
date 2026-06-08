import { Elysia } from 'elysia'
import { z } from 'zod'

// General-purpose AI gateway — an OpenAI-compatible surface at /ai/v1/* backing
// Argo's own AI features (NOT the Hermes agent; that lives under /hermes).
// Group 1 ships only GET /ai/v1/models (empty list) so the surface is mounted
// and discoverable. Real handlers land in Group 3:
//   • POST /ai/v1/chat/completions — DeepSeek v4 Flash via the LiteLLM EU bridge
//     (thread titling, classification)
//   • POST /ai/v1/audio/transcriptions — STT (audio-proxy)
//   • POST /ai/v1/audio/speech — TTS (audio-proxy)
// See docs/HERMES-CHAT-PRD.md.

const ModelSchema = z.object({
  id: z.string().describe('Model id (e.g. DeepSeek-V4-Flash)'),
  object: z.literal('model'),
  owned_by: z.string().describe('Provider that owns the model'),
})

export const aiRoutes = new Elysia({ prefix: '/ai' }).get(
  '/v1/models',
  () => ({ object: 'list' as const, data: [] as Array<z.infer<typeof ModelSchema>> }),
  {
    response: z.object({
      object: z.literal('list'),
      data: z.array(ModelSchema),
    }),
    detail: {
      tags: ['AI Gateway'],
      summary: 'List available gateway models',
      description:
        'OpenAI-compatible model listing for the general AI gateway. Returns an empty list in this scaffold; Group 3 populates it with the configured DeepSeek model and wires the chat/transcription/speech endpoints. This is the Argo-owned gateway (DeepSeek + STT/TTS) — for chatting with the Hermes agent use POST /hermes/chat instead.',
      security: [{ BearerAuth: [] }],
    },
  },
)
