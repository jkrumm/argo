import { spawn } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import {
  CHUNK_DEFAULTS,
  defaultPrep,
  enforceChunkLimits,
  fallbackTitle,
  parsePrepResponse,
  SAMPLE_RATE_DEFAULT,
  type ChunkLimits,
  type PrepChunk,
  type PrepResult,
} from './chunking.js'

// Native STT + Gemini-expressive TTS, talking directly to the IU unified endpoint.
// Ported from the standalone audio-proxy service (transcriptions.ts / speech.ts /
// gemini-tts.ts) so Argo owns the whole audio path — no second hop to a Mac-Mini
// service. The one behavioural change versus the original: per-chunk Gemini
// synthesis runs with bounded concurrency (not a serial loop), which is the fix
// for long-form TTS timing out. See apps/api/CLAUDE.md.

/** Minimal fetch shape shared with the AI gateway (matches tracedFetch). */
export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface AudioUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type RecordAudioUsage = (params: {
  model: string
  usage: AudioUsage
  subTool?: string
  startedAt: string
  durationMs: number
}) => Promise<void>

/** Everything the audio handlers need — production wires real adapters; tests stub them. */
export interface AudioDeps {
  /** IU OpenAI-dialect base (STT `/audio/transcriptions`, TTS prep `/chat/completions`). */
  iuBaseURL: string
  /** IU bearer, shared across the OpenAI and Gemini endpoints. */
  iuApiKey: string
  /** IU native Gemini base (`/models/{id}:generateContent`); empty → Gemini TTS 503s. */
  geminiBaseURL: string
  /** Default TTS model when the request omits one. */
  ttsModel: string
  /** Prep LLM (OpenAI dialect) that rewrites text into styled chunks. */
  ttsPrepModel: string
  ttsVoice: string
  ttsPrepMode: 'always' | 'long' | 'off'
  /** Max concurrent Gemini chunk syntheses. >1 is the long-form latency fix. */
  ttsConcurrency: number
  mp3BitrateKbps: number
  /** STT steering injected only when the client sends none. */
  sttPrompt: string
  sttLanguage: string
  fetchImpl: FetchImpl
  recordUsage: RecordAudioUsage
  /** ffmpeg adapter (overridable in tests). */
  transcodePcm: (pcm: Uint8Array, sampleRate: number, opus: boolean) => Promise<Encoded>
  /** ffprobe adapter (overridable in tests). */
  probeDurationSec: (file: File) => Promise<number>
}

const VOICES = new Set([
  // Male
  'Charon',
  'Schedar',
  'Iapetus',
  'Algieba',
  'Orus',
  'Puck',
  'Enceladus',
  'Sadachbia',
  'Rasalgethi',
  'Sadaltager',
  'Achird',
  'Umbriel',
  'Alnilam',
  'Fenrir',
  'Algenib',
  'Zubenelgenubi',
  // Female
  'Sulafat',
  'Kore',
  'Leda',
  'Callirrhoe',
  'Despina',
  'Laomedeia',
  'Gacrux',
  'Pulcherrima',
  'Vindemiatrix',
  'Zephyr',
  'Aoede',
  'Autonoe',
  'Erinome',
  'Achernar',
])
const DEFAULT_VOICE = 'Charon'
const SILENCE_MS = 400
const GEMINI_TTS = /gemini.*tts/i

const CHUNK_LIMITS: ChunkLimits = {
  targetWords: CHUNK_DEFAULTS.targetWords,
  maxWords: CHUNK_DEFAULTS.maxWords,
  maxBytes: CHUNK_DEFAULTS.maxBytes,
}

const PREP_SYSTEM_PROMPT = `You prepare text for Gemini text-to-speech in the persona of Hermes — a calm, warm, concise "sharp older friend". No greetings, no filler, substance first.

Your job, in order:
1. Detect the language of the input: "de" (German) or "en" (English).
2. Write a short title (3–6 words) summarizing the content, IN the transcript's language, suitable as a filename/label: plain words, no quotes, no trailing punctuation, no emoji.
3. Rewrite numbers, times, dates, units and abbreviations into the spoken form IN that language (German: "Viertel nach neun", "neunzig Kilo", "achtzehn Uhr dreißig"; English: "quarter past nine", "ninety kilos"). Do not translate the text — keep its language.
4. Split the text into short chunks of about 110 words each (never more than 150), so each chunk is only about 40–50 seconds of speech — Gemini TTS quality degrades once a single chunk runs past ~60 seconds. Break at paragraph boundaries first, then at sentence boundaries; never split in the middle of a sentence. Short text stays a single chunk.
5. For each chunk, write a "style" directive (one short sentence) IN the transcript's language describing the warm, calm Hermes delivery, and embed 1–2 SPARSE inline tags inside the chunk's "text" at natural points. Use only these tags: German [pause] [nachdenklich] [lacht] [seufzt] [begeistert] [bestimmt] [flüsternd]; English [pause] [thoughtful] [chuckles] [sigh] [excited] [firm] [whispers]. Do not over-tag — one or two per chunk. Tags are performance cues, never read aloud.

Return STRICT JSON only, no markdown, no commentary:
{"lang":"de"|"en","title":"<short title>","chunks":[{"style":"<directive>","text":"<transcript with inline tags>"}]}`

function iuHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, ...extra }
}

interface RawResponse {
  status: number
  body: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** fetch with backoff retry on transient 503/429 (mirrors the audio-proxy handling). */
async function rawFetch(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<RawResponse> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetchImpl(url, init)
    if ((res.status === 503 || res.status === 429) && attempt < attempts) {
      await sleep(500 * attempt)
      continue
    }
    return { status: res.status, body: await res.text() }
  }
  throw new Error('unreachable')
}

/** Run the prep LLM (OpenAI dialect) and record a prep usage row. */
async function runPrep(input: string, deps: AudioDeps): Promise<PrepResult> {
  const isLong = input.length >= CHUNK_DEFAULTS.charThreshold
  if (deps.ttsPrepMode === 'off') return defaultPrep(input)
  if (deps.ttsPrepMode === 'long' && !isLong) return defaultPrep(input)

  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const res = await rawFetch(deps.fetchImpl, `${deps.iuBaseURL}/chat/completions`, {
    method: 'POST',
    headers: iuHeaders(deps.iuApiKey, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      model: deps.ttsPrepModel,
      messages: [
        { role: 'system', content: PREP_SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      // Reasoning-capable OpenAI models reject `max_tokens`; the modern field works.
      max_completion_tokens: Math.min(32000, Math.max(2000, input.length + 1000)),
    }),
  })
  const durationMs = Date.now() - startMs

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`TTS prep failed: HTTP ${res.status} ${res.body.slice(0, 300)}`)
  }

  const json = JSON.parse(res.body) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  if (json.usage?.prompt_tokens !== undefined) {
    await deps
      .recordUsage({
        model: deps.ttsPrepModel,
        usage: {
          prompt_tokens: json.usage.prompt_tokens ?? 0,
          completion_tokens: json.usage.completion_tokens ?? 0,
          total_tokens: json.usage.total_tokens ?? 0,
        },
        subTool: 'tts-prep',
        startedAt,
        durationMs,
      })
      .catch(() => {})
  }

  const content = json.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) throw new Error('TTS prep returned empty content (no choices in response)')
  return parsePrepResponse(content)
}

interface ChunkAudio {
  pcm: Uint8Array
  sampleRate: number
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
  }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

/** Synthesize one chunk on Gemini and record a synth usage row. Fails loud on missing audio. */
async function synthChunk(
  model: string,
  voiceName: string,
  chunk: PrepChunk,
  deps: AudioDeps,
): Promise<ChunkAudio> {
  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const res = await rawFetch(
    deps.fetchImpl,
    `${deps.geminiBaseURL}/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: iuHeaders(deps.iuApiKey, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${chunk.style}: ${chunk.text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 1.0,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    },
  )
  const durationMs = Date.now() - startMs

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Gemini TTS failed: HTTP ${res.status} ${res.body.slice(0, 300)}`)
  }

  const parsed = JSON.parse(res.body) as GeminiTtsResponse
  const inline = parsed.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!inline?.data) {
    throw new Error(`Gemini TTS returned no audio: HTTP ${res.status} ${res.body.slice(0, 300)}`)
  }
  const pcm = Uint8Array.from(Buffer.from(inline.data, 'base64'))
  const sampleRate = Number(/rate=(\d+)/.exec(inline.mimeType ?? '')?.[1]) || SAMPLE_RATE_DEFAULT

  if (parsed.usageMetadata?.promptTokenCount !== undefined) {
    await deps
      .recordUsage({
        model,
        usage: {
          prompt_tokens: parsed.usageMetadata.promptTokenCount ?? 0,
          completion_tokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
          total_tokens:
            (parsed.usageMetadata.promptTokenCount ?? 0) +
            (parsed.usageMetadata.candidatesTokenCount ?? 0),
        },
        subTool: 'tts',
        startedAt,
        durationMs,
      })
      .catch(() => {})
  }

  return { pcm, sampleRate }
}

/** Run `fn` over items with bounded concurrency, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i] as T, i)
    }
  }
  const count = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: count }, () => worker()))
  return results
}

/** Concatenate s16le PCM chunks with SILENCE_MS of zeroed silence between them. */
function concatPcm(parts: ChunkAudio[]): { pcm: Uint8Array; sampleRate: number } {
  const sampleRate = parts[0]?.sampleRate ?? SAMPLE_RATE_DEFAULT
  const silenceBytes = Math.round((SILENCE_MS / 1000) * sampleRate) * 2 // 16-bit mono
  const gaps = Math.max(0, parts.length - 1)
  const total = parts.reduce((n, p) => n + p.pcm.byteLength, 0) + gaps * silenceBytes
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach((p, i) => {
    out.set(p.pcm, offset)
    offset += p.pcm.byteLength
    if (i < parts.length - 1) offset += silenceBytes // leave zeroed silence
  })
  return { pcm: out, sampleRate }
}

export interface Encoded {
  bytes: ArrayBuffer
  contentType: string
}

/** Real ffmpeg transcode: raw s16le PCM → compressed MP3 (default) or Opus/OGG. */
export function makeFfmpegTranscoder(bitrateKbps: number) {
  return function transcodePcm(
    pcm: Uint8Array,
    sampleRate: number,
    opus: boolean,
  ): Promise<Encoded> {
    const codec = opus
      ? ['-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg']
      : ['-c:a', 'libmp3lame', '-b:a', `${bitrateKbps}k`, '-f', 'mp3']
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      String(sampleRate),
      '-ac',
      '1',
      '-i',
      'pipe:0',
      ...codec,
      'pipe:1',
    ]
    return new Promise<Encoded>((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      proc.stdout?.on('data', (d: Buffer) => out.push(d))
      proc.stderr?.on('data', (d: Buffer) => err.push(d))
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `ffmpeg transcode failed (${code}): ${Buffer.concat(err).toString().slice(0, 300)}`,
            ),
          )
          return
        }
        const buf = Buffer.concat(out)
        const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        resolve({ bytes, contentType: opus ? 'audio/ogg' : 'audio/mpeg' })
      })
      // end(chunk) buffers and flushes the entire PCM payload, then closes stdin.
      // Node streams handle pipe backpressure internally — no partial-write truncation.
      proc.stdin?.end(Buffer.from(pcm))
    })
  }
}

/** Real ffprobe duration probe (best-effort; 0 if unavailable). */
export async function ffprobeDurationSec(file: File): Promise<number> {
  const tmp = `/tmp/argo-audio-${crypto.randomUUID()}`
  try {
    await writeFile(tmp, Buffer.from(await file.arrayBuffer()))
    const out = await new Promise<string>((resolve) => {
      const proc = spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', tmp],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      const chunks: Buffer[] = []
      proc.stdout?.on('data', (d: Buffer) => chunks.push(d))
      proc.on('error', () => resolve(''))
      proc.on('close', () => resolve(Buffer.concat(chunks).toString()))
    })
    const d = Number.parseFloat(out.trim())
    return Number.isFinite(d) ? d : 0
  } catch {
    return 0
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

/**
 * TTS handler. Gemini TTS models route to the native synth pipeline (prep → chunk
 * → parallel synth → concat → transcode); any other model is a straight proxy of
 * the IU OpenAI `/audio/speech`, returning the audio unchanged.
 */
export async function handleNativeSpeech(
  body: { model?: string; input?: string; voice?: string; response_format?: string },
  deps: AudioDeps,
): Promise<Response> {
  const model = body.model || deps.ttsModel
  const input = typeof body.input === 'string' ? body.input : ''
  const voice = body.voice || deps.ttsVoice
  const responseFormat = body.response_format ?? ''

  if (GEMINI_TTS.test(model)) {
    if (!deps.geminiBaseURL) {
      return Response.json(
        {
          error: {
            message: 'audio TTS not configured (AUDIO_GEMINI_BASE_URL unset)',
            type: 'config_error',
          },
        },
        { status: 503 },
      )
    }
    if (!input.trim()) {
      return Response.json(
        { error: { message: 'input is required', type: 'invalid_request_error' } },
        { status: 400 },
      )
    }

    const voiceName = VOICES.has(voice) ? voice : DEFAULT_VOICE
    const prep = await runPrep(input, deps)
    const chunks = enforceChunkLimits(prep.chunks, CHUNK_LIMITS)
    if (chunks.length === 0) {
      return Response.json(
        { error: { message: 'no speakable content', type: 'invalid_request_error' } },
        { status: 400 },
      )
    }
    // Parallel, order-preserving synthesis — the long-form latency fix.
    const parts = await mapWithConcurrency(chunks, deps.ttsConcurrency, (chunk) =>
      synthChunk(model, voiceName, chunk, deps),
    )
    const { pcm, sampleRate } = concatPcm(parts)
    const { bytes, contentType } = await deps.transcodePcm(
      pcm,
      sampleRate,
      responseFormat === 'opus',
    )

    const title = prep.title || fallbackTitle(input, prep.lang === 'de')
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': contentType, 'x-audio-title': encodeURIComponent(title) },
    })
  }

  // Non-Gemini passthrough to the IU OpenAI /audio/speech.
  const res = await deps.fetchImpl(`${deps.iuBaseURL}/audio/speech`, {
    method: 'POST',
    headers: iuHeaders(deps.iuApiKey, { 'content-type': 'application/json' }),
    body: JSON.stringify({ ...body, model }),
  })
  const audio = await res.arrayBuffer()
  return new Response(audio, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'audio/mpeg' },
  })
}

const SYNTH_MODEL = /transcribe/i
const RICH_FORMATS = new Set(['verbose_json', 'srt', 'vtt'])

interface SttUsage {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

const srtTime = (s: number): string => {
  const ms = Math.max(0, Math.round(s * 1000))
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')
  const sec = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')
  const milli = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${sec},${milli}`
}

const verboseJson = (text: string, duration: number, language: string | null) => ({
  task: 'transcribe',
  language: language ?? 'unknown',
  duration,
  text,
  segments: [
    {
      id: 0,
      seek: 0,
      start: 0,
      end: duration,
      text,
      tokens: [] as number[],
      temperature: 0,
      avg_logprob: 0,
      compression_ratio: 1,
      no_speech_prob: 0,
    },
  ],
})

const srt = (text: string, duration: number): string =>
  `1\n${srtTime(0)} --> ${srtTime(duration)}\n${text}\n`
const vtt = (text: string, duration: number): string =>
  `WEBVTT\n\n${srtTime(0).replace(',', '.')} --> ${srtTime(duration).replace(',', '.')}\n${text}\n`

/**
 * STT handler. `gpt-4o(-mini)-transcribe` only support `json`/`text` upstream, so
 * for rich formats (`verbose_json`/`srt`/`vtt`) we ask IU for `json` and synthesize
 * the envelope locally (single-block timing via ffprobe duration). `whisper` rich
 * formats and plain json/text pass through. Language steering is injected only when
 * the client sends none.
 */
export async function handleNativeTranscriptions(
  form: FormData,
  deps: AudioDeps,
): Promise<Response> {
  const model = String(form.get('model') ?? '')
  const clientFormat = String(form.get('response_format') ?? 'json')
  const language = form.get('language') ? String(form.get('language')) : null
  const file = form.get('file')

  const synth = SYNTH_MODEL.test(model) && RICH_FORMATS.has(clientFormat)

  const upstream = new FormData()
  for (const [key, value] of form.entries()) {
    if (key === 'response_format' || key === 'timestamp_granularities[]') continue
    upstream.append(key, value)
  }
  upstream.append('response_format', synth ? 'json' : clientFormat)
  if (!form.has('language') && deps.sttLanguage) upstream.append('language', deps.sttLanguage)
  if (!form.has('prompt') && deps.sttPrompt) upstream.append('prompt', deps.sttPrompt)

  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const res = await deps.fetchImpl(`${deps.iuBaseURL}/audio/transcriptions`, {
    method: 'POST',
    headers: iuHeaders(deps.iuApiKey),
    body: upstream,
  })
  const durationMs = Date.now() - startMs
  const contentType = res.headers.get('content-type') ?? ''
  const body = await res.text()

  if (!res.ok) {
    return new Response(body, { status: res.status, headers: { 'content-type': contentType } })
  }

  let text = body
  let usage: SttUsage | null = null
  let detectedLang = language ?? (deps.sttLanguage || null)
  if (contentType.includes('application/json')) {
    const json = JSON.parse(body) as Record<string, unknown>
    text = typeof json['text'] === 'string' ? json['text'] : ''
    usage = (json['usage'] as SttUsage | undefined) ?? null
    if (typeof json['language'] === 'string') detectedLang = json['language']
  }

  if (usage) {
    const prompt = usage.input_tokens ?? usage.prompt_tokens ?? 0
    const completion = usage.output_tokens ?? usage.completion_tokens ?? 0
    await deps
      .recordUsage({
        model,
        usage: {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: usage.total_tokens ?? prompt + completion,
        },
        subTool: 'stt',
        startedAt,
        durationMs,
      })
      .catch(() => {})
  }

  if (synth && file instanceof File) {
    const duration = await deps.probeDurationSec(file)
    if (clientFormat === 'verbose_json')
      return Response.json(verboseJson(text, duration, detectedLang))
    if (clientFormat === 'srt') {
      return new Response(srt(text, duration), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    return new Response(vtt(text, duration), {
      headers: { 'content-type': 'text/vtt; charset=utf-8' },
    })
  }

  if (clientFormat === 'json') return Response.json({ text })
  return new Response(body, { status: res.status, headers: { 'content-type': contentType } })
}
