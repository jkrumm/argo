// Shared API base URL, resolved once — the single definition for this origin. Also declared
// verbatim in features/hermes-chat/transport.ts (lane-3-owned; that file is deleted in a later
// phase of the Hermes Chat v2 program) — the duplication is deliberate during the migration
// rather than editing a file this lane doesn't own.
//
// Trailing slashes are stripped so every caller can concatenate `/path` unconditionally, and an
// empty or slash-only VITE_API_URL falls back to the same-origin `/api` instead of collapsing to
// `''` — the astro map turns this value into a bearer-token allowlist prefix, where `''` would
// widen the match to every root-relative and protocol-relative URL.
const configured = import.meta.env.VITE_API_URL?.replace(/\/+$/, '')

export const apiBase: string = configured || `${window.location.origin}/api`
