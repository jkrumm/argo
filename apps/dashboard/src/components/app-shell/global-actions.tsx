import { RefreshButton, TimerNavWidget } from '../timer-nav'

/**
 * Global slot of the app-shell top bar — shell-owned and persistent across routes (unlike
 * the per-page `PageActions` slot). Today: the running-timer pill + the soft refresh.
 * Future home for app-level widgets — notifications, today's tasks, incident / server
 * health — so the global bar stays the single insertion point. See `page-header.tsx`.
 */
export function GlobalActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <TimerNavWidget />
      <RefreshButton />
    </div>
  )
}
