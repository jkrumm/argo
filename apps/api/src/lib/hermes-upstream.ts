// Thin transport layer for the Hermes named-event chat API. This module owns
// exactly two upstream calls — session precondition + opening the SSE turn —
// and the pure mapping from a UIMessage's parts to the wire's `message` field.
// It does not parse the SSE body (see hermes-events.ts) and does not map events
// to AI SDK chunks (see hermes-chunks.ts); routing/persistence lives in
// routes/hermes.ts. See docs/HERMES-CHAT-V2.md for the phase A2 brief.
//
// VERIFIED live against Hermes v0.19.1 (not re-derived here):
//   - `HERMES_BASE_URL` ends in `/v1`, but `/api/*` is NOT under `/v1` — the
//     origin is derived the same way the existing `/health` probe in
//     routes/hermes.ts does: `new URL('/api/...', baseURL)` (a leading slash
//     resets the path, dropping `/v1`).
//   - `POST /api/sessions/{id}/chat/stream` does NOT create sessions — a
//     missing session 404s `session_not_found`. `POST {origin}/api/sessions`
//     with `{ id, source: 'api_server' }` returns 201 on create and 409 (code
//     `session_exists`) on duplicate — BOTH are success.
//   - Request headers: `Authorization: Bearer <HERMES_API_KEY>` (set by hand —
//     no OpenAI-compatible provider synthesizes it anymore),
//     `Content-Type: application/json`, and `X-Hermes-Session-Key` when
//     present. There is no `X-Hermes-Session-Id` header — the session id lives
//     in the URL path instead.
//   - Request body is a SINGLE user turn, not a message list: Hermes owns its
//     own history. `{ message: <string | content-part[]>, system_message,
//     model? }`. Content parts accept ONLY `{type:'text'|'input_text'|
//     'output_text', text}` and `{type:'image_url'|'input_image', image_url}`.
//   - Response is `200 text/event-stream`; a pre-stream failure uses the
//     OpenAI error envelope `{"error":{message,type,param,code}}`.

import type { TraceOptions } from './traced-fetch.js'
// basalt-agent-allow — deliberate per locked decision D3: apps/api stays on ai@5; this import is type-only (UIMessage's part shape) to translate a turn's parts into Hermes' own wire format, never ai@7 (docs/HERMES-CHAT-V2.md).
import type { UIMessage } from 'ai'

/**
 * Minimal fetch shape shared with `tracedFetch` — the third, optional
 * `traceOptions` argument is purely additive so a plain 2-arg test double
 * still satisfies this type.
 */
export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
  traceOptions?: TraceOptions,
) => Promise<Response>

export type HermesTextContentPart = { type: 'text'; text: string }
export type HermesImageContentPart = { type: 'image_url'; image_url: string }
export type HermesMessageContentPart = HermesTextContentPart | HermesImageContentPart
/** The wire's `message` field: a plain string (text-only turn) or a content-part array. */
export type HermesMessageContent = string | HermesMessageContentPart[]

/** Thrown when a Hermes upstream call fails (pre-stream). Carries the parsed
 * OpenAI-envelope error when the body was well-formed JSON. */
export class HermesUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'HermesUpstreamError'
  }
}

/** Thrown by `buildHermesMessageContent` on a part Hermes cannot accept
 * (a non-image file attachment) — never dropped silently. */
export class HermesContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HermesContentError'
  }
}

/** Parse a pre-stream failure body as the OpenAI error envelope; falls back to
 * a generic message when the body is missing/not-JSON/shaped differently. */
async function parseUpstreamError(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const data = (await res.json()) as { error?: { message?: unknown; code?: unknown } }
    const message = data.error?.message
    const code = data.error?.code
    if (typeof message === 'string' && message.length > 0) {
      return { message, ...(typeof code === 'string' ? { code } : {}) }
    }
  } catch {
    // non-JSON or unexpected shape — fall through to the generic message
  }
  return { message: `Hermes upstream returned ${res.status}` }
}

/**
 * Idempotent session precondition. Call on EVERY turn, not just at thread
 * creation — it is one cheap request, and it is what stops a Hermes DB reset
 * or mini rebuild from 404-ing a thread forever. Resolves on 201 (created) or
 * 409 (already exists, `code: "session_exists"` on the real upstream — but
 * ANY 409 is treated as success here per the verified contract); throws
 * `HermesUpstreamError` otherwise.
 */
export async function ensureHermesSession(args: {
  fetchImpl: FetchImpl
  baseURL: string
  apiKey: string
  sessionId: string
}): Promise<void> {
  const url = new URL('/api/sessions', args.baseURL)
  // No `traceOptions` passed here — the default (non-streamed) span is
  // correct for this call: the body is only ever read on the error branch
  // (`parseUpstreamError`), never streamed by the caller, so there is
  // nothing for `streamLifecycle` to keep the span open for.
  const res = await args.fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: args.sessionId, source: 'api_server' }),
  })
  if (res.status === 201 || res.status === 409) return
  const { message, code } = await parseUpstreamError(res)
  throw new HermesUpstreamError(message, res.status, code)
}

/**
 * Open the named-event SSE turn for one user message. Hermes owns
 * conversation history per session, so the body carries only the new turn.
 * Resolves with the raw `Response` (status 200, `text/event-stream`) for the
 * caller to hand to `parseHermesEvents`; throws `HermesUpstreamError` on any
 * non-200 (pre-stream failure, OpenAI error envelope).
 */
export async function openHermesChatStream(args: {
  fetchImpl: FetchImpl
  baseURL: string
  apiKey: string
  sessionId: string
  sessionKey?: string | undefined
  message: HermesMessageContent
  systemMessage: string
  model?: string | undefined
  signal?: AbortSignal | undefined
  traceOptions?: TraceOptions | undefined
}): Promise<Response> {
  const url = new URL(
    `/api/sessions/${encodeURIComponent(args.sessionId)}/chat/stream`,
    args.baseURL,
  )
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.apiKey}`,
    'Content-Type': 'application/json',
  }
  if (args.sessionKey) headers['X-Hermes-Session-Key'] = args.sessionKey

  const body: { message: HermesMessageContent; system_message: string; model?: string } = {
    message: args.message,
    system_message: args.systemMessage,
  }
  if (args.model) body.model = args.model

  const res = await args.fetchImpl(
    url.toString(),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(args.signal ? { signal: args.signal } : {}),
    },
    args.traceOptions,
  )
  if (res.status !== 200) {
    const { message, code } = await parseUpstreamError(res)
    throw new HermesUpstreamError(message, res.status, code)
  }
  return res
}

/**
 * Map a UIMessage's parts to Hermes' `message` field. Text parts concatenate;
 * a `file` part maps to an `image_url` content part when its media type is an
 * image, and THROWS `HermesContentError` for any other file part — Hermes'
 * own upstream rejects a non-image file part with 400, so Argo refuses it
 * up front with a clear typed error instead of forwarding (and instead of
 * silently dropping it, which would send a truncated turn). Every other part
 * kind (reasoning, tool, source, data, step-start) carries nothing Hermes'
 * `message` field understands and is skipped. When every part is text, the
 * result collapses to a plain string (Hermes' `message: string` shape);
 * otherwise it's the OpenAI-style content-part array.
 */
export function buildHermesMessageContent(parts: UIMessage['parts']): HermesMessageContent {
  const contentParts: HermesMessageContentPart[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text) contentParts.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'file') {
      if (!part.mediaType.startsWith('image/')) {
        throw new HermesContentError(
          `Unsupported attachment type "${part.mediaType}" — Hermes only accepts image attachments.`,
        )
      }
      contentParts.push({ type: 'image_url', image_url: part.url })
      continue
    }
    // reasoning / tool / source-url / source-document / data-* / step-start —
    // no user-facing content Hermes' message field understands. Skipped.
  }
  if (contentParts.every((p) => p.type === 'text')) {
    return contentParts.map((p) => (p as HermesTextContentPart).text).join('')
  }
  return contentParts
}
