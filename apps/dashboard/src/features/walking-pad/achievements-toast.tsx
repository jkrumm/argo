import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import confetti from 'canvas-confetti'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { ACHIEVEMENT_LAST_SEEN_ID_KEY, ACHIEVEMENT_WATERMARK_KEY } from './constants'

function fireConfetti() {
  confetti({ particleCount: 80, spread: 70, origin: { y: 0.6, x: 0.5 } })
  setTimeout(() => {
    confetti({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0, y: 0.65 } })
    confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.65 } })
  }, 200)
}

function colorFor(type: string): string {
  if (type === 'first_walk') return 'blue'
  if (type.startsWith('distance_milestone')) return 'teal'
  if (type.startsWith('streak_')) return 'orange'
  if (type === 'weekly_distance_pr') return 'grape'
  if (type === 'multi_walk_day') return 'cyan'
  return 'green'
}

/**
 * Watches `/walking-pad/achievements` for unlocks the user hasn't seen yet.
 *
 * The cross-session guard is `lastSeenId` in localStorage — achievement IDs
 * are a monotonic serial PK, so "seen" is just `id <= lastSeenId`. This
 * survives page reloads (the previous in-memory toastedIds ref did not, which
 * caused confetti to re-fire on every open because the API's `since` filter
 * is inclusive). The `since` timestamp is still used to narrow the API
 * response payload, but is no longer the dedup signal.
 */
export function useAchievementWatcher() {
  const initialWatermark = useRef<string>(getWatermark())
  const lastSeenId = useRef<number>(getLastSeenId())

  const { data } = useQuery({
    ...walkingPadQueries.achievements({ since: initialWatermark.current, limit: 20 }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (data === undefined) return
    const fresh = data.data.filter((a) => a.id > lastSeenId.current)
    if (fresh.length === 0) return

    if (fresh.some((a) => a.confetti)) fireConfetti()
    for (const a of fresh) {
      notifications.show({
        color: colorFor(a.type),
        title: a.title,
        message: a.description,
        autoClose: 7000,
      })
    }

    const maxId = fresh.reduce((m, a) => (a.id > m ? a.id : m), lastSeenId.current)
    lastSeenId.current = maxId
    setLastSeenId(maxId)

    const newest = fresh.reduce(
      (acc, a) => (a.unlocked_at > acc ? a.unlocked_at : acc),
      initialWatermark.current,
    )
    setWatermark(newest)
  }, [data])
}

function getWatermark(): string {
  try {
    const v = localStorage.getItem(ACHIEVEMENT_WATERMARK_KEY)
    if (v !== null && v.length > 0) return v
  } catch {
    // localStorage unavailable — fall through to the conservative default.
  }
  // Default: "from now" — never re-toast historical unlocks on first load.
  return new Date().toISOString()
}

function setWatermark(iso: string) {
  try {
    localStorage.setItem(ACHIEVEMENT_WATERMARK_KEY, iso)
  } catch {
    // Ignore.
  }
}

function getLastSeenId(): number {
  try {
    const v = localStorage.getItem(ACHIEVEMENT_LAST_SEEN_ID_KEY)
    if (v === null || v.length === 0) return 0
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function setLastSeenId(id: number) {
  try {
    localStorage.setItem(ACHIEVEMENT_LAST_SEEN_ID_KEY, String(id))
  } catch {
    // Ignore.
  }
}
