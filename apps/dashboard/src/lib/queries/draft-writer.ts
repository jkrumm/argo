/**
 * The write side of the workout draft, free of React so it can be tested alone: pending edits are
 * kept per exercise (a second exercise's edit never replaces the first's), each debounced on its
 * own, and every network task runs one at a time so overlapping PUTs cannot land out of order.
 */
export type DraftWriter<T> = {
  /** Queue a debounced write of one exercise's draft. */
  push(exerciseId: string, draft: T): void
  /** Send every pending write now. */
  flush(): void
  /** Drop one exercise's unsent write. */
  cancel(exerciseId: string): void
  /** Run a task after everything already queued (a DELETE must not overtake a PUT). */
  run(task: () => Promise<unknown>): void
  /** True when nothing is pending, waiting on a debounce, or in flight. */
  isIdle(): boolean
}

export function createDraftWriter<T>(
  save: (exerciseId: string, draft: T) => Promise<unknown>,
  debounceMs: number,
): DraftWriter<T> {
  const pending = new Map<string, T>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let chain: Promise<unknown> = Promise.resolve()
  let inFlight = 0

  const run = (task: () => Promise<unknown>) => {
    inFlight += 1
    chain = chain
      .then(task)
      .catch(() => undefined)
      .then(() => {
        inFlight -= 1
      })
  }

  const send = (exerciseId: string) => {
    const timer = timers.get(exerciseId)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(exerciseId)
    if (!pending.has(exerciseId)) return
    const draft = pending.get(exerciseId) as T
    pending.delete(exerciseId)
    run(() => save(exerciseId, draft))
  }

  return {
    push(exerciseId, draft) {
      pending.set(exerciseId, draft)
      const timer = timers.get(exerciseId)
      if (timer !== undefined) clearTimeout(timer)
      timers.set(
        exerciseId,
        setTimeout(() => send(exerciseId), debounceMs),
      )
    },
    flush() {
      for (const exerciseId of pending.keys()) send(exerciseId)
    },
    cancel(exerciseId) {
      const timer = timers.get(exerciseId)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(exerciseId)
      pending.delete(exerciseId)
    },
    run,
    isIdle: () => pending.size === 0 && timers.size === 0 && inFlight === 0,
  }
}
