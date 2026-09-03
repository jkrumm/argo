import { emit } from 'basalt-ui/notifications'
import confetti from 'canvas-confetti'
import type { Achievement } from '../../lib/queries/workouts'

/**
 * Mirrors the old strength-tracker `fireConfetti` — a central burst plus two
 * angled side bursts a moment later.
 */
function fireConfetti() {
  confetti({ particleCount: 80, spread: 70, origin: { y: 0.6, x: 0.5 } })
  setTimeout(() => {
    confetti({ particleCount: 40, angle: 60, spread: 55, origin: { x: 0, y: 0.65 } })
    confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.65 } })
  }, 200)
}

/**
 * Fire one notification per achievement and optionally trigger confetti.
 * Called after a workout-create mutation resolves. Confetti fires once per
 * call when any achievement has `confetti: true` — multiple consecutive
 * mutations cannot stack bursts since each call is its own scope.
 */
export function showAchievements(achievements: Achievement[] | undefined) {
  if (!achievements || achievements.length === 0) return

  if (achievements.some((a) => a.confetti)) fireConfetti()

  for (const a of achievements) {
    emit('achievement:unlocked', { message: a.description }, { title: a.title, autoClose: 6000 })
  }
}
