import { describe, it, expect } from 'bun:test'
import { app } from '../index.js'

// Auth-surface tests only — the live Atlassian REST round-trip is exercised
// via apps/api/scripts/jira-discover.ts. No upstream mock yet; once we have
// stable response contracts we can add a recorded-fixture harness.

describe('GET /atlassian/jira/* — auth', () => {
  for (const path of [
    '/atlassian/jira/me',
    '/atlassian/jira/my-issues',
    '/atlassian/jira/issue/EP-1',
    '/atlassian/jira/current-sprint',
    '/atlassian/jira/sprints',
    '/atlassian/jira/sprints/1',
    '/atlassian/jira/backlog',
    '/atlassian/jira/search?jql=assignee=currentUser()',
  ]) {
    it(`rejects missing bearer with 401 on ${path}`, async () => {
      const res = await app.handle(new Request(`http://localhost${path}`))
      expect(res.status).toBe(401)
    })

    it(`rejects wrong bearer with 401 on ${path}`, async () => {
      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          headers: { Authorization: 'Bearer not-the-real-secret' },
        }),
      )
      expect(res.status).toBe(401)
    })
  }
})
