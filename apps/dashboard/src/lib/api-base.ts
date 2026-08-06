// Shared API base URL, resolved once. Also declared verbatim in
// features/hermes-chat/transport.ts (lane-3-owned; that file is deleted in a
// later phase of the Hermes Chat v2 program) — the duplication is deliberate
// during the migration rather than editing a file this lane doesn't own.
export const apiBase = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`
