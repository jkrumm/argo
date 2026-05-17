import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import confetti from 'canvas-confetti'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { ACHIEVEMENT_WATERMARK_KEY } from './constants'

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
 * Watches `/walking-pad/achievements` for unlocks since the last-seen
 * watermark (persisted in localStorage). On new unlocks, fires a toast per
 * achievement and one confetti burst if any has `confetti: true`. The
 * watermark is bumped to the newest seen unlock so we don't re-toast on
 * the next poll.
 *
 * Mount once at the page root. Returns nothing; just performs side effects.
 */
export function useAchievementWatcher() {
  // We refetch alongside live (every 5s here, vs 2s for live) so a new PR
  // appears within ~5 s of the daemon closing the session.
  const initialWatermark = useRef<string>(getWatermark())
  const { data } = useQuery({
    ...walkingPadQueries.achievements({ since: initialWatermark.current, limit: 20 }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })

  // Track which achievement ids we've already toasted in this session so a
  // remount or a missed `since` update doesn't re-toast.
  const toastedIds = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (data === undefined) return
    const fresh = data.data.filter((a) => !toastedIds.current.has(a.id))
    if (fresh.length === 0) return

    if (fresh.some((a) => a.confetti)) fireConfetti()
    for (const a of fresh) {
      notifications.show({
        color: colorFor(a.type),
        title: a.title,
        message: a.description,
        autoClose: 7000,
      })
      toastedIds.current.add(a.id)
    }
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
