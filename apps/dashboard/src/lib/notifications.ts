/**
 * notifications.ts — Argo's typed notification kind registry (see basalt-ui/notifications:
 * `defineNotifications`'s contract is "call it once — the app's single registry; the last call
 * wins"). Every kind carries a `{ message: ReactNode }` payload — `toMessage` is a passthrough,
 * so the call site builds the exact copy (title still passed per-call via `emit`'s opts, since
 * NotificationSpec has no title field).
 *
 * Kinds are grouped by domain + intent (not one-off per call site) — e.g. every red "the reading
 * feature failed to do X" toast in hermes-chat shares `chat:error`; only the message/title differ.
 * Achievement toasts (walking-pad, strength-tracker) are NOT registered here — see the header
 * comment in those two files for why.
 */
import type { ReactNode } from 'react'
import { defineNotifications } from 'basalt-ui/notifications'

type MessagePayload = { message: ReactNode }

const toMessage = (payload: unknown): ReactNode => (payload as MessagePayload).message

export const NOTIFICATIONS = defineNotifications({
  // ── Reading (Hardcover match + shelf sync) ───────────────────────────────
  'reading:success': { intent: 'success', toMessage },
  'reading:partial': { intent: 'warning', toMessage },
  'reading:error': { intent: 'error', toMessage },

  // ── Body composition (weight + skinfold logging) ─────────────────────────
  'body-comp:save-success': { intent: 'success', toMessage },
  'body-comp:save-error': { intent: 'error', toMessage },

  // ── Hermes chat (attachments, voice playback, transcription) ─────────────
  'chat:error': { intent: 'error', toMessage },
  'chat:warning': { intent: 'warning', toMessage },

  // ── Dev tooling (theme lab, etc.) ─────────────────────────────────────────
  'dev:info': { intent: 'info', toMessage },

  // ── Strength-tracker timer (rest / interval done) ─────────────────────────
  'timer:done': { intent: 'info', toMessage },
})

declare module 'basalt-ui' {
  interface BasaltRegister {
    notifications: typeof NOTIFICATIONS
  }
}
