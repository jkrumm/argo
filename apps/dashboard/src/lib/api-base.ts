// Shared API base URL, resolved once — the single definition for this origin.
//
// Trailing slashes are stripped so every caller can concatenate `/path` unconditionally, and an
// empty or slash-only VITE_API_URL falls back to the same-origin `/api` instead of collapsing to
// `''` — the astro map turns this value into a bearer-token allowlist prefix, where `''` would
// widen the match to every root-relative and protocol-relative URL.
const configured = import.meta.env['VITE_API_URL']?.replace(/\/+$/, '')

export const apiBase: string = configured || `${window.location.origin}/api`
