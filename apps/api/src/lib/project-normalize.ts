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

  // Anchor on the workspace root so a cwd inside a subdirectory of the repo
  // (e.g. /IuRoot/prometheus-scripts/vpn) collapses to the repo name rather
  // than the leaf segment.
  const rooted = trimmed.match(/\/(?:Source|Iu)Root\/([^/]+)/)
  if (rooted) return rooted[1] ?? null

  const segments = trimmed.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  return last ?? trimmed
}

export type Workspace = 'work' | 'private'

/**
 * Heuristic for repo names that came out of ~/IuRoot but lost their full
 * path before classification. Only used by historical-data backfills now;
 * the live ingest accepts a workspace from the collector and falls back
 * to a pure path-based check, so adding a new IuRoot repo here is not
 * required for going-forward classification.
 */
const WORK_REPO_RE = /^(epos[._]|prometheus[-_]|crm-bridge|cfn-kafka|terraform-monitoring)/i

/**
 * Classify a usage record into a workspace from its cwd-style project.
 * Collectors that own their workspace (hermes/feuer/opencode/audio-proxy)
 * declare it on their definition and the value lands in `record.workspace`
 * directly — this helper is the per-record fallback for path-driven sources
 * (claude-code, litellm) where the cwd determines the workspace.
 *
 *   /Users/<user>/IuRoot/...      → 'work'
 *   /Users/<user>/SourceRoot/...  → 'private'
 *   bare repo names               → matched against WORK_REPO_RE (back-compat)
 *   anything else                 → null
 */
export function classifyWorkspace(project: string | null | undefined): Workspace | null {
  if (project === null || project === undefined) return null
  const trimmed = project.trim()
  if (trimmed === '') return null

  if (trimmed.includes('/IuRoot/')) return 'work'
  if (trimmed.includes('/SourceRoot/')) return 'private'

  if (trimmed.includes('/')) return null

  return WORK_REPO_RE.test(trimmed) ? 'work' : 'private'
}
