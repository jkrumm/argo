import type { AgentPart, ThreadRunState } from 'basalt-ui/agent'

/**
 * Whether a thread's run entry is a turn in flight. A `runs` entry exists for a live turn AND for a
 * failed one (`status: 'error'`, kept until the next `start()`/`retry()` or `stop()`), so entry
 * presence is not liveness — the status is.
 */
export function isLiveRun(run: ThreadRunState<AgentPart> | undefined): boolean {
  return run?.status === 'submitted' || run?.status === 'streaming'
}
