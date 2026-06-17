import { RefreshButton, TimerNavWidget } from '../timer-nav'
import { HermesVoiceButton } from '../../features/hermes-chat/hermes-voice-button'
import { HermesWidget } from '../../features/hermes-chat/hermes-widget'

/**
 * Global slot of the app-shell top bar — shell-owned and persistent across routes (unlike
 * the per-page `PageActions` slot). Today: the running-timer pill + the soft refresh.
 * Future home for app-level widgets — notifications, today's tasks, incident / server
 * health — so the global bar stays the single insertion point. See `page-header.tsx`.
 */
export function GlobalActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <HermesVoiceButton />
      <HermesWidget />
      <TimerNavWidget />
      <RefreshButton />
    </div>
  )
}
