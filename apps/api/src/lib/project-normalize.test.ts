import { describe, it, expect } from 'bun:test'
import { normalizeProject } from './project-normalize.js'

describe('normalizeProject', () => {
  it('returns repo name from SourceRoot path', () => {
    expect(normalizeProject('/Users/jkrumm/SourceRoot/free-planning-poker')).toBe(
      'free-planning-poker',
    )
  })

  it('returns repo name from IuRoot path', () => {
    expect(normalizeProject('/Users/jkrumm/IuRoot/prometheus-feuer-agent')).toBe(
      'prometheus-feuer-agent',
    )
    expect(normalizeProject('/Users/jkrumm/IuRoot/epos.student-enrolment')).toBe(
      'epos.student-enrolment',
    )
  })

  it('collapses worktree paths to the main repo', () => {
    expect(
      normalizeProject(
        '/Users/jkrumm/IuRoot/worktrees/epos.student-enrolment/steel-mesa/epos.student-enrolment',
      ),
    ).toBe('epos.student-enrolment')
    expect(normalizeProject('/Users/jkrumm/SourceRoot/worktrees/argo/feature-x/argo')).toBe('argo')
  })

  it('falls back to basename for arbitrary paths', () => {
    expect(normalizeProject('/tmp/scratch-project')).toBe('scratch-project')
    expect(normalizeProject('/Users/jkrumm/Obsidian/Vault')).toBe('Vault')
  })

  it('handles trailing slash', () => {
    expect(normalizeProject('/Users/jkrumm/SourceRoot/argo/')).toBe('argo')
  })

  it('returns the value unchanged when already a bare name', () => {
    expect(normalizeProject('argo')).toBe('argo')
  })

  it('returns null for null/undefined/empty', () => {
    expect(normalizeProject(null)).toBeNull()
    expect(normalizeProject(undefined)).toBeNull()
    expect(normalizeProject('')).toBeNull()
    expect(normalizeProject('   ')).toBeNull()
  })
})
