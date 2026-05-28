/**
 * Normalize a cwd-style project path into a stable display name.
 *
 * Rules:
 *   /Users/jkrumm/IuRoot/worktrees/<repo>/<branch>/<repo>  → <repo>
 *   /Users/jkrumm/IuRoot/<repo>                            → <repo>
 *   /Users/jkrumm/SourceRoot/<repo>                        → <repo>
 *   any other path                                         → basename
 *   null / empty                                           → null
 *
 * Worktrees collapse to the main repo so filters and groupBy
 * don't fragment by branch.
 */
export function normalizeProject(project: string | null | undefined): string | null {
  if (project === null || project === undefined) return null
  const trimmed = project.trim()
  if (trimmed === '') return null

  const worktree = trimmed.match(/\/worktrees\/([^/]+)\//)
  if (worktree) return worktree[1] ?? null

  const segments = trimmed.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  return last ?? trimmed
}

export type Workspace = 'work' | 'private'

/**
 * Heuristic for repo names that came out of ~/IuRoot but lost their
 * full path before classification (used by the migration backfill).
 */
const WORK_REPO_RE = /^(epos[._]|prometheus[-_]|crm-bridge|cfn-kafka|terraform-monitoring)/i

/**
 * Source-level overrides for collectors whose workspace is fixed by
 * the daemon itself, independent of any cwd they emit. `feuer` is the
 * IuRoot Prometheus Feuer agent (always work); `hermes`, `opencode`,
 * `audio-proxy` are personal Mac Mini tooling (always private).
 */
const WORK_SOURCES = new Set(['feuer'])
const PRIVATE_SOURCES = new Set(['hermes', 'opencode', 'audio-proxy'])

/**
 * Classify a usage record into a workspace.
 *
 * Source overrides win when a collector is dedicated to one workspace
 * (e.g. `feuer` always emits work usage, even when its rows carry a
 * generic project like `cron` or `cli`). Otherwise the cwd path is used:
 *
 *   /Users/<user>/IuRoot/...      → 'work'
 *   /Users/<user>/SourceRoot/...  → 'private'
 *   bare repo names               → matched against WORK_REPO_RE
 *   anything else                 → null
 */
export function classifyWorkspace(
  project: string | null | undefined,
  source?: string | null,
): Workspace | null {
  if (source) {
    if (WORK_SOURCES.has(source)) return 'work'
    if (PRIVATE_SOURCES.has(source)) return 'private'
  }

  if (project === null || project === undefined) return null
  const trimmed = project.trim()
  if (trimmed === '') return null

  if (trimmed.includes('/IuRoot/')) return 'work'
  if (trimmed.includes('/SourceRoot/')) return 'private'

  if (trimmed.includes('/')) return null

  return WORK_REPO_RE.test(trimmed) ? 'work' : 'private'
}
