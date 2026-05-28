import { describe, it, expect } from 'bun:test'
import { classifyWorkspace, normalizeProject } from './project-normalize.js'

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

  it('collapses subdirectories of a repo to the repo name', () => {
    expect(normalizeProject('/Users/jkrumm/IuRoot/prometheus-scripts/vpn')).toBe(
      'prometheus-scripts',
    )
    expect(normalizeProject('/Users/jkrumm/IuRoot/prometheus-scripts/cron/some-script.py')).toBe(
      'prometheus-scripts',
    )
    expect(normalizeProject('/Users/jkrumm/SourceRoot/argo/apps/api')).toBe('argo')
    expect(normalizeProject('/Users/jkrumm/SourceRoot/argo/apps/dashboard/src/routes')).toBe('argo')
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

describe('classifyWorkspace', () => {
  it('returns work for IuRoot paths (including worktrees)', () => {
    expect(classifyWorkspace('/Users/jkrumm/IuRoot/epos.student-enrolment')).toBe('work')
    expect(
      classifyWorkspace(
        '/Users/jkrumm/IuRoot/worktrees/epos.student-enrolment/steel-mesa/epos.student-enrolment',
      ),
    ).toBe('work')
    expect(classifyWorkspace('/Users/jkrumm/IuRoot/prometheus-feuer-agent')).toBe('work')
  })

  it('returns private for SourceRoot paths', () => {
    expect(classifyWorkspace('/Users/jkrumm/SourceRoot/argo')).toBe('private')
    expect(classifyWorkspace('/Users/jkrumm/SourceRoot/free-planning-poker')).toBe('private')
  })

  it('classifies bare repo names via heuristic', () => {
    expect(classifyWorkspace('epos.student-enrolment')).toBe('work')
    expect(classifyWorkspace('epos_fe.booking')).toBe('work')
    expect(classifyWorkspace('prometheus-feuer-agent')).toBe('work')
    expect(classifyWorkspace('crm-bridge-retry-tool')).toBe('work')
    expect(classifyWorkspace('cfn-kafka')).toBe('work')
    expect(classifyWorkspace('argo')).toBe('private')
    expect(classifyWorkspace('free-planning-poker')).toBe('private')
  })

  it('returns null for unclassifiable paths and empty input', () => {
    expect(classifyWorkspace('/tmp/scratch')).toBeNull()
    expect(classifyWorkspace(null)).toBeNull()
    expect(classifyWorkspace(undefined)).toBeNull()
    expect(classifyWorkspace('')).toBeNull()
  })
})
