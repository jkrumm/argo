import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only team roster store. Backs `apps/api/m365-team.json` — committed to
// git, hand-editable, source of truth for the team structure (roles + the
// cross-system identity links agents need to translate between Teams ↔ Jira ↔
// GitLab). Intentionally PII-light: no emails. Only display names (already
// public in the org) + opaque platform IDs (UUIDs/usernames, not credentials).

export type Role = 'PO' | 'EM' | 'TechLead' | 'UX' | 'AgileCoach' | 'Dev'

export interface TeamMember {
  alias: string
  displayName: string | null
  role: Role
  self?: boolean
  ms: { userId: string | null }
  atlassian: { accountId: string | null }
  gitlab: { username: string | null }
}

export interface Team {
  team: string
  members: TeamMember[]
}

interface FileShape {
  version: 1
  team: string
  members: TeamMember[]
}

const moduleDir = dirname(fileURLToPath(import.meta.url))
const TEAM_FILE = join(moduleDir, '..', '..', 'm365-team.json')

export function readTeam(): Team {
  if (!existsSync(TEAM_FILE)) return { team: 'unknown', members: [] }
  const raw = JSON.parse(readFileSync(TEAM_FILE, 'utf-8')) as Partial<FileShape>
  return { team: raw.team ?? 'unknown', members: raw.members ?? [] }
}
