import { Elysia } from 'elysia'
import { z } from 'zod'
import { join } from 'node:path'
import { tracedFetch, type TraceOptions } from '../lib/traced-fetch.js'
import { env } from '../env.js'
import { recordAiUsage, type RecordUsageFn } from '../lib/ai-usage.js'
import { log } from '../telemetry.js'
import {
  createDiskAudioStore,
  hashScript,
  serveAudioBytes,
  type AudioStore,
} from '../lib/audio-cache.js'

// General-purpose AI gateway — an OpenAI-compatible surface at /ai/v1/* backing
// Argo's own AI features (NOT the Hermes agent; that lives under /hermes).
//
//   • POST /ai/v1/chat/completions   — the model named by DEEPSEEK_MODEL on the
//                                       IU unified endpoint (thread titling, classification)
//   • POST /ai/v1/audio/transcriptions — proxied to the agent-workflows audio door
//   • POST /ai/v1/audio/speech        — proxied to the agent-workflows audio door
//   • GET  /ai/v1/models              — advertise the configured model(s)
//
// The chat/models handlers are thin proxies that inject the upstream bearer
// server-side (never leaked to the client). The audio handlers forward requests
// to the agent-workflows audio door (the single source of truth for STT + TTS), with a
// caller bearer (`AUDIO_DOOR_TOKEN`).
// `aiComplete()` is the in-process seam thread titling imports without an HTTP hop.
// All upstreams are reached via `tracedFetch` (OTel CLIENT spans). See docs/HERMES-CHAT-V2.md.

/**
 * Minimal fetch shape (no `preconnect`) — matches `tracedFetch`, so the gateway
 * and its tests share one transport type and a fake upstream is trivial to
 * inject. The optional third `traceOptions` param mirrors `tracedFetch`'s own
 * signature so call sites can opt a proxy into `streamLifecycle: true`; a test
 * stub that only declares `(input, init)` remains assignable (the extra param
 * stays optional).
 */
export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
  traceOptions?: TraceOptions,
) => Promise<Response>

/** Injectable upstream config so tests can point at fake endpoint / audio door. */
export interface AiRouteDeps {
  /** Chat upstream base URL (IU unified endpoint, OpenAI transport), incl. `/v1`. */
  deepseekBaseURL: string
  deepseekApiKey: string
  deepseekModel: string
  /** Top-level `reasoning_effort` sent with every `aiComplete` call. */
  deepseekReasoningEffort: string
  /** Audio door base URL (`https://<host>:<port>`); empty → audio 503. */
  audioDoorUrl: string
  /** Audio door caller bearer; empty → audio 503. */
  audioDoorToken: string
  /** Underlying transport the gateway wraps (defaults to the OTel-traced fetch). */
  fetchImpl: FetchImpl
  /**
   * Usage recorder called after each `aiComplete` call when the upstream returns
   * token counts. Defaults to `recordAiUsage` (DB write). Override in tests to
   * spy without touching the DB.
   */
  recordUsage: RecordUsageFn
  /** Content-addressed store for synthesized podcast audio. */
  audioStore: AudioStore
}

function defaultDeps(): AiRouteDeps {
  return {
    deepseekBaseURL: env.DEEPSEEK_BASE_URL,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL,
    deepseekReasoningEffort: env.DEEPSEEK_REASONING_EFFORT,
    audioDoorUrl: env.AUDIO_DOOR_URL,
    audioDoorToken: env.AUDIO_DOOR_TOKEN,
    fetchImpl: tracedFetch,
    recordUsage: recordAiUsage,
    audioStore: createDiskAudioStore(join(env.DATA_DIR, 'audio-cache')),
  }
}

/** Join a base URL (with or without trailing slash) and an absolute path. */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

function bearer(key: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {}
}

/** Caller label forwarded to the audio door (`x-audio-source`) next to the bearer. */
const AUDIO_SOURCE_HEADER: Record<string, string> = { 'x-audio-source': 'argo-api' }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

interface AudioDoor {
  url: string
  headers: Record<string, string>
  /** A redirect would replay the bearer at another location: every door call errors on one. */
  redirect: 'error'
}

/**
 * Resolved audio door target: base URL plus what every upstream call carries
 * (bearer + caller label, no redirects). `null` when the door is not usable — URL or token unset,
 * unparseable URL, or plain http to a non-loopback host (the bearer must never cross
 * the network in clear) — and the route then answers 503.
 */
function audioDoor(deps: AiRouteDeps): AudioDoor | null {
  if (!deps.audioDoorUrl || !deps.audioDoorToken) return null
  let parsed: URL
  try {
    parsed = new URL(deps.audioDoorUrl)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))
  )
    return null
  return {
    url: deps.audioDoorUrl.replace(/\/+$/, ''),
    headers: { ...AUDIO_SOURCE_HEADER, ...bearer(deps.audioDoorToken) },
    redirect: 'error',
  }
}

const doorFailure = (message: string) =>
  Response.json({ error: { message, type: 'upstream_error' } }, { status: 502 })

/**
 * One call to the audio door. The door's own auth failure (401/403: argo's credential,
 * not the client's) and a thrown fetch (door down, TLS, redirect) both become a 502 with
 * a generic message — never the door's status as argo's own 401, never the URL or host
 * in a body or log.
 */
async function doorFetch(
  deps: AiRouteDeps,
  door: AudioDoor,
  path: string,
  init: Omit<RequestInit, 'redirect' | 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  let res: Response
  try {
    res = await deps.fetchImpl(
      `${door.url}${path}`,
      { ...init, headers: { ...init.headers, ...door.headers }, redirect: door.redirect },
      { streamLifecycle: true },
    )
  } catch {
    log.error('argo audio door unreachable', { path })
    return doorFailure('audio door unreachable')
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => {})
    log.error('argo audio door rejected the caller credential', { path, status: res.status })
    return doorFailure('audio door rejected the request')
  }
  return res
}

const audioNotConfigured = (what: 'STT' | 'TTS') => ({
  error: {
    message: `audio ${what} not configured (AUDIO_DOOR_URL / AUDIO_DOOR_TOKEN unset, or http to a non-loopback host)`,
    type: 'config_error',
  },
})

/**
 * Re-wrap an upstream response for the client: keep the content-type, drop the
 * body's transfer encoding/length (fetch already decoded it), and disable proxy
 * buffering so streamed completions flush promptly.
 */
function proxyHeaders(upstream: Headers, fallbackContentType: string): Headers {
  const headers = new Headers()
  headers.set('content-type', upstream.get('content-type') ?? fallbackContentType)
  // Bun's fetch auto-decompresses the body, so the upstream's compressed
  // content-length / content-encoding are wrong for the forwarded stream.
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.set('X-Accel-Buffering', 'no')
  return headers
}

const ModelSchema = z.object({
  id: z.string().describe('Model id, as configured by DEEPSEEK_MODEL'),
  object: z.literal('model'),
  owned_by: z.string().describe('Provider that owns the model'),
})

const ChatCompletionsBodySchema = z
  .object({
    model: z
      .string()
      .describe('Model id. Defaults to the configured model (DEEPSEEK_MODEL) when omitted.')
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
    summarize: z
      .boolean()
      .describe(
        'Condense the input into a single short spoken sentence before synthesis (hands-free voice-mode replies). Off by default — read-aloud speaks the full text.',
      )
      .optional(),
  })
  .passthrough()

const PodcastBodySchema = z
  .object({
    script: z.string().min(1).describe('Full spoken text to synthesize as a podcast episode.'),
    title: z
      .string()
      .describe('Human-readable title for the episode. Falls back to the audio door x-audio-title.')
      .optional(),
  })
  .passthrough()

/**
 * Default `max_completion_tokens` for callers that don't size their own
 * budget. `deepseekModel` is a reasoning model that spends this budget on
 * hidden reasoning before visible content — an under-budgeted call returns
 * HTTP 200 with empty content and `finish_reason: "length"`, not an error.
 * Unused budget is never billed, so this errs generous (>=16000, per the
 * reasoning-model floor).
 */
export const AI_DEFAULT_MAX_COMPLETION_TOKENS = 16000

/**
 * In-process helper: a single non-streaming chat completion returning the
 * assistant text. Group 4's thread titling imports this directly (no HTTP hop).
 * Token usage is recorded fire-and-forget into argo.usage_record (source='argo')
 * when the upstream returns a usage object.
 *
 * `deepseekModel` is a reasoning model: an empty completion with
 * `finish_reason: "length"` means the budget was spent entirely on hidden
 * reasoning tokens, not a real failure. On empty content or `finish_reason:
 * "length"` this retries ONCE with a doubled `max_completion_tokens`, then
 * throws — callers that must never throw (e.g. `completeSentence`) wrap this
 * in their own try/catch. A discarded truncated/empty attempt is still billed
 * (the upstream call happened) but recorded with `outcome: 'error'`, never `'ok'`.
 */
export async function aiComplete(
  prompt: string,
  opts: {
    system?: string
    model?: string
    maxTokens?: number
    /** Usage-record sub_tool tag, e.g. 'titling' | 'summarization'. */
    sub_tool?: string
    deps?: Partial<AiRouteDeps>
  } = {},
): Promise<string> {
  const deps = { ...defaultDeps(), ...opts.deps }
  if (!deps.deepseekBaseURL) throw new Error('AI gateway not configured (DEEPSEEK_BASE_URL unset)')

  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: prompt },
  ]
  const model = opts.model ?? deps.deepseekModel

  let maxTokens = opts.maxTokens ?? AI_DEFAULT_MAX_COMPLETION_TOKENS
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    const res = await deps.fetchImpl(joinUrl(deps.deepseekBaseURL, '/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(deps.deepseekApiKey) },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        reasoning_effort: deps.deepseekReasoningEffort,
        max_completion_tokens: maxTokens,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // The upstream call was attempted (and billed, if it partially ran) — record
      // an error-outcome row so `outcome` has a real denominator. Fire-and-forget
      // with its own `.catch()`: a DB failure here must never replace the real
      // upstream error the caller is about to throw.
      deps
        .recordUsage({
          model,
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          ...(opts.sub_tool !== undefined ? { subTool: opts.sub_tool } : {}),
          startedAt,
          durationMs: Date.now() - startMs,
          outcome: 'error',
        })
        .catch((err: unknown) => log.error('argo ai usage record failed (error path)', err))
      throw new Error(`AI completion failed: ${res.status} ${detail.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        completion_tokens_details?: { reasoning_tokens?: number }
        cost?: number
      }
      model?: string
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    const finishReason = json.choices?.[0]?.finish_reason
    // A truncated/empty attempt is billed (the upstream call happened, and
    // ran a real reasoning budget) but discarded — never recorded as 'ok'.
    const discarded = content.trim().length === 0 || finishReason === 'length'

    if (json.usage?.prompt_tokens !== undefined) {
      deps
        .recordUsage({
          model: json.model ?? model,
          usage: {
            prompt_tokens: json.usage.prompt_tokens ?? 0,
            completion_tokens: json.usage.completion_tokens ?? 0,
            total_tokens: json.usage.total_tokens ?? 0,
            ...(json.usage.prompt_tokens_details?.cached_tokens !== undefined
              ? { cached_tokens: json.usage.prompt_tokens_details.cached_tokens }
              : {}),
            ...(json.usage.completion_tokens_details?.reasoning_tokens !== undefined
              ? { reasoning_tokens: json.usage.completion_tokens_details.reasoning_tokens }
              : {}),
            ...(json.usage.cost !== undefined ? { cost: json.usage.cost } : {}),
          },
          ...(opts.sub_tool !== undefined ? { subTool: opts.sub_tool } : {}),
          startedAt,
          durationMs: Date.now() - startMs,
          ...(discarded ? { outcome: 'error' as const } : {}),
        })
        .catch((err: unknown) => log.error('argo ai usage record failed', err))
    }

    if (!discarded) return content

    log.warn('argo ai completion returned empty/truncated content', {
      sub_tool: opts.sub_tool,
      finishReason,
      maxTokens,
      attempt,
    })

    if (attempt === 0) {
      maxTokens *= 2
      continue
    }
    throw new Error(
      `AI completion returned no usable content (finish_reason: ${finishReason ?? 'unknown'})`,
    )
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error('AI completion failed unexpectedly')
}

export function createAiRoutes(overrides: Partial<AiRouteDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides }

  return new Elysia({ name: 'ai', prefix: '/ai' })
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
            'OpenAI-compatible model listing for the general AI gateway. Advertises the configured model (`DEEPSEEK_MODEL`, served directly by the IU unified endpoint, EU/GDPR) used for titling/classification. STT/TTS run through /ai/v1/audio/* and are not selectable here. This is the Argo-owned gateway — to chat with the Hermes agent use POST /hermes/chat instead.',
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
        // Default the model to the configured one (DEEPSEEK_MODEL); an explicit
        // `model` in the body wins. Routing to the EU-resident IU endpoint is
        // what keeps the request GDPR-compliant regardless of the model field.
        const payload = { model: deps.deepseekModel, ...(body as Record<string, unknown>) }
        const res = await deps.fetchImpl(
          joinUrl(deps.deepseekBaseURL, '/chat/completions'),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...bearer(deps.deepseekApiKey) },
            body: JSON.stringify(payload),
          },
          { streamLifecycle: true },
        )
        return new Response(res.body, {
          status: res.status,
          headers: proxyHeaders(res.headers, 'application/json'),
        })
      },
      {
        body: ChatCompletionsBodySchema,
        detail: {
          tags: ['AI Gateway'],
          summary: 'OpenAI-compatible chat completion (configured model, EU)',
          description:
            'Proxies an OpenAI chat-completion request to the configured model (`DEEPSEEK_MODEL`) on the IU unified endpoint (OpenAI transport), with the endpoint API key kept server-side. Used for fast Argo-side tasks like thread titling and classification. `model` defaults to that configured model; routing always targets the EU-resident IU endpoint (GDPR). Supports non-streaming (default) and `stream: true` SSE. Response mirrors the upstream OpenAI shape.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/v1/audio/transcriptions',
      async ({ body, status }) => {
        const door = audioDoor(deps)
        if (!door) return status(503, audioNotConfigured('STT'))
        // Elysia parses multipart/form-data into a plain object (File fields stay
        // File/Blob). Rebuild the FormData faithfully so the upstream filename is
        // preserved (the STT endpoint needs it).
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
        // Do NOT set Content-Type — fetch sets the multipart boundary automatically.
        const upstream = await doorFetch(deps, door, '/v1/audio/transcriptions', {
          method: 'POST',
          body: form,
        })
        const headers = new Headers()
        headers.set('content-type', upstream.headers.get('content-type') ?? 'application/json')
        return new Response(upstream.body, { status: upstream.status, headers })
      },
      {
        // No body schema: multipart STT accepting the full OpenAI transcription
        // field set (file, model, language, response_format, prompt, …).
        // Elysia still parses the multipart body by content-type.
        detail: {
          tags: ['AI Gateway'],
          summary: 'OpenAI-compatible speech-to-text (proxied to the audio door)',
          description:
            'Proxies multipart `/audio/transcriptions` to the agent-workflows audio door (caller bearer injected server-side), which handles format synthesis (`verbose_json`/`srt`/`vtt`), language steering, and the upstream bearer. Returns `{ text }` (json) or the requested rich format.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/v1/audio/speech',
      async ({ body, status }) => {
        const door = audioDoor(deps)
        if (!door) return status(503, audioNotConfigured('TTS'))
        const upstream = await doorFetch(deps, door, '/v1/audio/speech', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const headers = new Headers()
        headers.set('content-type', upstream.headers.get('content-type') ?? 'audio/mpeg')
        const audioTitle = upstream.headers.get('x-audio-title')
        if (audioTitle) headers.set('x-audio-title', audioTitle)
        return new Response(upstream.body, { status: upstream.status, headers })
      },
      {
        body: SpeechBodySchema,
        detail: {
          tags: ['AI Gateway'],
          summary: 'OpenAI-compatible text-to-speech (proxied to the audio door)',
          description:
            'Proxies `/audio/speech` to the agent-workflows audio door (caller bearer injected server-side; Gemini expressive pipeline or IU OpenAI passthrough). Body is the OpenAI speech shape (`model`, `input`, `voice`, `response_format`) plus the Argo-only `summarize` flag: set `summarize: true` to condense the input into a single ~30-word spoken confirmation before synthesis. Response is binary audio with an `x-audio-title` header.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
    .post(
      '/v1/audio/podcast',
      async ({ body, status }) => {
        const { script, title: requestTitle } = body as { script: string; title?: string }
        const hash = hashScript(script)

        // Cache hit — answered before the door config check: a cached episode needs
        // no door, and the door is not called again.
        if (await deps.audioStore.has(hash)) {
          const cached = await deps.audioStore.read(hash)
          return { hash, title: requestTitle ?? '', bytes: cached?.length ?? 0 }
        }

        const door = audioDoor(deps)
        if (!door) return status(503, audioNotConfigured('TTS'))

        const startedAt = new Date().toISOString()
        const startMs = Date.now()

        // Only send `input` — the audio door owns model selection.
        const upstream = await doorFetch(deps, door, '/v1/audio/speech', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: script }),
        })

        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '')
          // The audio door call was attempted and failed — record an
          // error-outcome row so `outcome` has a real denominator. Fire-and-forget
          // with its own `.catch()`: a DB failure here must never replace the
          // 502 the client is about to receive.
          deps
            .recordUsage({
              // Legacy label kept on purpose: renaming would split the per-model usage history.
              model: 'audio-gateway/tts',
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
              subTool: 'podcast',
              // Genuinely IU spend: the door fronts the IU unified endpoint for
              // both TTS and STT — see modelpick/docs/decisions/audio-stack.md.
              // Explicit here (not relying on the default) so the attribution
              // is self-documenting.
              billing: 'iu',
              startedAt,
              durationMs: Date.now() - startMs,
              outcome: 'error',
            })
            .catch((err: unknown) =>
              log.error('argo podcast usage record failed (error path)', err),
            )
          return status(502, {
            error: {
              message: `audio door error: ${detail.slice(0, 200)}`,
              type: 'upstream_error',
            },
          })
        }

        const bytes = new Uint8Array(await upstream.arrayBuffer())
        await deps.audioStore.write(hash, bytes)

        const doorTitle = upstream.headers.get('x-audio-title')
        const resolvedTitle = doorTitle ?? requestTitle ?? ''

        deps
          .recordUsage({
            // Legacy label kept on purpose: renaming would split the per-model usage history.
            model: 'audio-gateway/tts',
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            subTool: 'podcast',
            // Genuinely IU spend — see the matching comment on the error-path
            // recordUsage call above for the routing evidence.
            billing: 'iu',
            startedAt,
            durationMs: Date.now() - startMs,
          })
          .catch((err: unknown) => log.error('argo podcast usage record failed', err))

        return { hash, title: resolvedTitle, bytes: bytes.length }
      },
      {
        body: PodcastBodySchema,
        detail: {
          tags: ['AI Gateway'],
          summary: 'Synthesize and cache a podcast episode',
          description:
            'Synthesizes the given `script` as a spoken podcast episode via the audio door and caches the result content-addressed by sha256(script). On a cache hit the door is NOT called again. Returns `{ hash, title, bytes }` on 200. 503 when AUDIO_DOOR_URL / AUDIO_DOOR_TOKEN is unset or the URL is plain http to a non-loopback host; 502 when the door returns non-2xx. The frontend builds the playback URL as `GET /ai/v1/audio/file/{hash}` — a public, range-served, immutably-cached endpoint that supports browser `<audio>` scrubbing without re-synthesis. Do NOT pass a `model` field — the audio door owns model selection.',
          security: [{ BearerAuth: [] }],
        },
      },
    )
}

/** Deps for the public audio-file serving plugin (no auth required). */
export interface AudioFileDeps {
  audioStore: AudioStore
}

function defaultAudioFileDeps(): AudioFileDeps {
  return {
    audioStore: createDiskAudioStore(join(env.DATA_DIR, 'audio-cache')),
  }
}

/**
 * Public plugin serving cached podcast audio as range-friendly responses.
 *
 * Mounted BEFORE authGuard in index.ts — rationale: a bare `<audio src>` element
 * cannot send a bearer header. The 256-bit content hash is an unguessable
 * capability; Argo prod is Tailscale-only, so reading already-synthesized
 * content-addressed bytes is capability-gated without a bearer. Synthesis (the
 * costly guarded POST /ai/v1/audio/podcast) stays bearer-protected.
 */
export function createAudioFileRoutes(overrides: Partial<AudioFileDeps> = {}) {
  const deps = { ...defaultAudioFileDeps(), ...overrides }

  return new Elysia({ name: 'audio-file', prefix: '/ai' }).get(
    '/v1/audio/file/:hash',
    async ({ params, request, status }) => {
      const { hash } = params

      // Path-traversal guard: only lowercase hex, exactly 64 chars.
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        return status(400, {
          error: { message: 'invalid hash format', type: 'invalid_request' },
        })
      }

      const bytes = await deps.audioStore.read(hash)
      if (!bytes) {
        return status(404, {
          error: { message: 'not found', type: 'not_found' },
        })
      }

      const rangeHeader = request.headers.get('range')
      return serveAudioBytes(bytes, rangeHeader)
    },
    {
      detail: {
        tags: ['AI Gateway'],
        summary: 'Serve cached podcast audio (public, range-supported)',
        description:
          'Public endpoint serving a synthesized podcast file by its sha256 content hash. Supports HTTP range requests (`Range: bytes=START-END`) for browser `<audio>` scrubbing — returns 206 Partial Content on a satisfiable range, 416 Range Not Satisfiable otherwise. Returns 400 on a malformed hash (path-traversal guard), 404 when the hash is unknown. Response is immutably cached (`Cache-Control: public, max-age=31536000, immutable`). No bearer required — the 256-bit hash is an unguessable capability; synthesis is separately guarded on POST /ai/v1/audio/podcast.',
      },
    },
  )
}

export const aiRoutes = createAiRoutes()
export const audioFileRoutes = createAudioFileRoutes()
