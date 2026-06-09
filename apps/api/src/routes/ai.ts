import { Elysia } from 'elysia'
import { z } from 'zod'
import { tracedFetch } from '../lib/traced-fetch.js'
import { env } from '../env.js'

// General-purpose AI gateway — an OpenAI-compatible surface at /ai/v1/* backing
// Argo's own AI features (NOT the Hermes agent; that lives under /hermes).
//
//   • POST /ai/v1/chat/completions   — DeepSeek v4 Flash on the IU unified
//                                       endpoint (thread titling, classification)
//   • POST /ai/v1/audio/transcriptions — STT (audio-proxy)
//   • POST /ai/v1/audio/speech        — TTS (audio-proxy)
//   • GET  /ai/v1/models              — advertise the configured model(s)
//
// Each handler is a thin proxy: it injects the upstream bearer server-side
// (never leaked to the client) and streams the upstream response straight back.
// `aiComplete()` is the in-process seam Group 4's titling imports without going
// back out over HTTP. All upstreams are OpenAI-compatible and reached via
// `tracedFetch` (OTel CLIENT spans). See docs/HERMES-CHAT-PRD.md.

/**
 * Minimal fetch shape (no `preconnect`) — matches `tracedFetch`, so the gateway
 * and its tests share one transport type and a fake upstream is trivial to
 * inject.
 */
export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Injectable upstream config so tests can point at fake endpoint / audio-proxy. */
export interface AiRouteDeps {
  /** DeepSeek base URL (IU unified endpoint, OpenAI transport), incl. `/v1`. */
  deepseekBaseURL: string
  deepseekApiKey: string
  deepseekModel: string
  /** audio-proxy base URL, including the `/v1` path prefix. */
  audioBaseURL: string
  /** Optional bearer the audio-proxy gates on; empty → no header sent. */
  audioApiKey: string
  /** Underlying transport the gateway wraps (defaults to the OTel-traced fetch). */
  fetchImpl: FetchImpl
}

function defaultDeps(): AiRouteDeps {
  return {
    deepseekBaseURL: env.DEEPSEEK_BASE_URL,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL,
    audioBaseURL: env.AUDIO_PROXY_BASE_URL,
    audioApiKey: env.AUDIO_PROXY_API_KEY,
    fetchImpl: tracedFetch,
  }
}

/** Join a base URL (with or without trailing slash) and an absolute path. */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

function bearer(key: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {}
}

/**
 * Re-wrap an upstream response for the client: keep the content-type, drop the
 * body's transfer encoding/length (fetch already decoded it), and disable proxy
 * buffering so streamed completions flush promptly.
 */
function proxyHeaders(upstream: Headers, fallbackContentType: string): Headers {
  const headers = new Headers()
  headers.set('content-type', upstream.get('content-type') ?? fallbackContentType)
  headers.set('X-Accel-Buffering', 'no')
  return headers
}

const ModelSchema = z.object({
  id: z.string().describe('Model id (e.g. DeepSeek-V4-Flash)'),
  object: z.literal('model'),
  owned_by: z.string().describe('Provider that owns the model'),
})

const ChatCompletionsBodySchema = z
  .object({
    model: z
      .string()
      .describe('Model id. Defaults to the configured DeepSeek model when omitted.')
      .optional(),
    messages: z.array(z.unknown()).describe('OpenAI chat messages.').optional(),
    stream: z.boolean().describe('Stream the completion as SSE. Default: false.').optional(),
  })
  .passthrough()

const SpeechBodySchema = z
  .object({
    model: z.string().describe('TTS model id.').optional(),
    input: z.string().describe('Text to synthesize.'),
    voice: z.string().describe('Voice name.').optional(),
    response_format: z.string().describe('Audio container, e.g. mp3/opus.').optional(),
  })
  .passthrough()

/**
 * In-process helper: a single non-streaming DeepSeek completion returning the
 * assistant text. Group 4's thread titling imports this directly (no HTTP hop).
 */
export async function aiComplete(
  prompt: string,
  opts: {
    system?: string
    model?: string
    temperature?: number
    maxTokens?: number
    deps?: Partial<AiRouteDeps>
  } = {},
): Promise<string> {
  const deps = { ...defaultDeps(), ...opts.deps }
  if (!deps.deepseekBaseURL) throw new Error('AI gateway not configured (DEEPSEEK_BASE_URL unset)')

  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: prompt },
  ]
  const res = await deps.fetchImpl(joinUrl(deps.deepseekBaseURL, '/chat/completions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...bearer(deps.deepseekApiKey) },
    body: JSON.stringify({
      model: opts.model ?? deps.deepseekModel,
      messages,
      stream: false,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI completion failed: ${res.status} ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return json.choices?.[0]?.message?.content ?? ''
}

export function createAiRoutes(overrides: Partial<AiRouteDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides }

  return new Elysia({ prefix: '/ai' })
    .get(
      '/v1/models',
      () => ({
        object: 'list' as const,
        data: deps.deepseekModel
          ? [{ id: deps.deepseekModel, object: 'model' as const, owned_by: 'iu-unified-endpoint' }]
          : [],
      }),
      {
        response: z.object({
          object: z.literal('list'),
          data: z.array(ModelSchema),
        }),
        detail: {
          tags: ['AI Gateway'],
          summary: 'List available gateway models',
          description:
            'OpenAI-compatible model listing for the general AI gateway. Advertises the configured DeepSeek model (served directly by the IU unified endpoint, EU/GDPR) used for titling/classification. STT/TTS run through /ai/v1/audio/* and are not selectable here. This is the Argo-owned gateway — to chat with the Hermes agent use POST /hermes/chat instead.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/v1/chat/completions',
      async ({ body, status }) => {
        if (!deps.deepseekBaseURL) {
          return status(503, {
            error: { message: 'AI gateway not configured', type: 'config_error' },
          })
        }
        // Default the model to the configured DeepSeek model; an explicit
        // `model` in the body wins. Routing to the EU-resident IU endpoint is
        // what keeps the request GDPR-compliant regardless of the model field.
        const payload = { model: deps.deepseekModel, ...(body as Record<string, unknown>) }
        const res = await deps.fetchImpl(joinUrl(deps.deepseekBaseURL, '/chat/completions'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...bearer(deps.deepseekApiKey) },
          body: JSON.stringify(payload),
        })
        return new Response(res.body, {
          status: res.status,
          headers: proxyHeaders(res.headers, 'application/json'),
        })
      },
      {
        body: ChatCompletionsBodySchema,
        detail: {
          tags: ['AI Gateway'],
          summary: 'OpenAI-compatible chat completion (DeepSeek v4 Flash, EU)',
          description:
            'Proxies an OpenAI chat-completion request to DeepSeek v4 Flash on the IU unified endpoint (OpenAI transport), with the endpoint API key kept server-side. Used for fast Argo-side tasks like thread titling and classification. `model` defaults to the configured DeepSeek model; routing always targets the EU-resident IU endpoint (GDPR). Supports non-streaming (default) and `stream: true` SSE. Response mirrors the upstream OpenAI shape.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/v1/audio/transcriptions',
      async ({ body, status }) => {
        if (!deps.audioBaseURL) {
          return status(503, {
            error: { message: 'audio-proxy not configured', type: 'config_error' },
          })
        }
        // Elysia parses multipart/form-data into a plain object (File fields stay
        // File/Blob). Rebuild the FormData faithfully and forward it; fetch sets
        // the multipart boundary itself, so we never set content-type here.
        const form = new FormData()
        const src = (body ?? {}) as Record<string, unknown>
        for (const [key, value] of Object.entries(src)) {
          if (value instanceof Blob) form.append(key, value)
          else if (Array.isArray(value)) {
            for (const item of value) {
              form.append(key, item instanceof Blob ? item : String(item))
            }
          } else if (value !== null && value !== undefined) form.append(key, String(value))
        }
        const res = await deps.fetchImpl(joinUrl(deps.audioBaseURL, '/audio/transcriptions'), {
          method: 'POST',
          headers: { ...bearer(deps.audioApiKey) },
          body: form,
        })
        return new Response(res.body, {
          status: res.status,
          headers: proxyHeaders(res.headers, 'application/json'),
        })
      },
      {
        // No body schema: this is a passthrough multipart proxy accepting the
        // full OpenAI transcription field set (file, model, language,
        // response_format, prompt, temperature, …). Elysia still parses the
        // multipart body by content-type.
        detail: {
          tags: ['AI Gateway'],
          summary: 'OpenAI-compatible speech-to-text (audio-proxy)',
          description:
            'Multipart `/audio/transcriptions` proxy to the audio-proxy STT endpoint, bearer kept server-side. Accepts the standard OpenAI fields (`file`, `model`, `language`, `response_format`, `prompt`, …) and returns the audio-proxy response verbatim (JSON `{ text }` or the requested rich format).',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/v1/audio/speech',
      async ({ body, status }) => {
        if (!deps.audioBaseURL) {
          return status(503, {
            error: { message: 'audio-proxy not configured', type: 'config_error' },
          })
        }
        const res = await deps.fetchImpl(joinUrl(deps.audioBaseURL, '/audio/speech'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...bearer(deps.audioApiKey) },
          body: JSON.stringify(body),
        })
        return new Response(res.body, {
          status: res.status,
          headers: proxyHeaders(res.headers, 'audio/mpeg'),
        })
      },
      {
        body: SpeechBodySchema,
        detail: {
          tags: ['AI Gateway'],
          summary: 'OpenAI-compatible text-to-speech (audio-proxy)',
          description:
            'Proxies `/audio/speech` to the audio-proxy TTS endpoint (bearer server-side) and streams the synthesized audio bytes straight back. Body is the OpenAI speech shape (`model`, `input`, `voice`, `response_format`). Response is binary audio (e.g. `audio/mpeg`), not JSON.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

export const aiRoutes = createAiRoutes()
