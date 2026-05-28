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
