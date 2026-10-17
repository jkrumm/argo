import type { WardenActionVerb } from '../../lib/queries/warden'

/** The two verbs that ask for a short reason/note before they fire — every other verb fires
 * immediately with no payload. */
export type PromptVerb = 'dismiss' | 'note'
export type PromptState = { eventId: number; verb: PromptVerb } | null

export const VERB_LABEL: Record<WardenActionVerb, string> = {
  implement: 'Implement',
  merge: 'Merge',
  dismiss: 'Dismiss',
  reinvestigate: 'Re-investigate',
  retry: 'Retry',
  note: 'Note',
}

export function needsPrompt(verb: WardenActionVerb): verb is PromptVerb {
  return verb === 'dismiss' || verb === 'note'
}
