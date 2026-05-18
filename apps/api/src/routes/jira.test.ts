import { describe, it, expect } from 'bun:test'
import { app } from '../index.js'
import { __test } from '../clients/jira.js'

// Auth-surface tests for every Jira route + unit tests for the ADF helpers
// that compose request bodies. The live Atlassian REST round-trip is
// exercised via apps/api/scripts/jira-discover.ts and jira-write-discover.ts.

const SECRET = process.env['API_SECRET'] ?? ''

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
    '/atlassian/jira/create-meta',
    '/atlassian/jira/issues/EP-1/transitions',
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

describe('Jira write routes — auth', () => {
  it('POST /atlassian/jira/issues rejects missing bearer', async () => {
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueType: 'Task', summary: 'x' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('PATCH /atlassian/jira/issues/EP-1 rejects missing bearer', async () => {
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/issues/EP-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'x' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('POST /atlassian/jira/issues/EP-1/comments rejects missing bearer', async () => {
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/issues/EP-1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'x' }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /atlassian/jira/create-meta', () => {
  it('returns the static metadata bundle', async () => {
    if (!SECRET) return // skipped when API_SECRET isn't loaded
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/create-meta', {
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      projectKey: string
      defaultTeam: string
      issueTypes: string[]
      priorities: string[]
      sprintRefs: string[]
    }
    expect(body.projectKey).toBe('EP')
    expect(body.defaultTeam).toBe('Prometheus')
    expect(body.issueTypes).toContain('Story')
    expect(body.priorities).toContain('Highest')
    expect(body.sprintRefs).toEqual(['current', 'next', 'backlog'])
  })
})

describe('Jira write validation', () => {
  it('rejects malformed key on PATCH', async () => {
    if (!SECRET) return
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/issues/not-a-key', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: 'x' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('rejects unknown issueType on create', async () => {
    if (!SECRET) return
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/issues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueType: 'Nonsense', summary: 'x' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('rejects empty summary on create', async () => {
    if (!SECRET) return
    const res = await app.handle(
      new Request('http://localhost/atlassian/jira/issues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueType: 'Task', summary: '' }),
      }),
    )
    expect(res.status).toBe(422)
  })
})

describe('Jira ADF helpers', () => {
  const { textToAdf, ensureFooterAdf, HERMES_FOOTER } = __test

  it('wraps plain text in an ADF doc and appends the footer', () => {
    const doc = textToAdf('First paragraph.\n\nSecond paragraph.', true)
    expect(doc.type).toBe('doc')
    expect(doc.version).toBe(1)
    // 2 paragraphs + 1 footer paragraph
    expect(doc.content).toHaveLength(3)
    const footer = doc.content[2]
    expect(footer?.content?.[0]?.text).toBe(HERMES_FOOTER)
    expect(footer?.content?.[0]?.marks?.[0]?.type).toBe('em')
  })

  it('renders the footer even when text is empty', () => {
    const doc = textToAdf('', true)
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]?.content?.[0]?.text).toBe(HERMES_FOOTER)
  })

  it('preserves single-newline hard breaks', () => {
    const doc = textToAdf('Line 1\nLine 2', false)
    expect(doc.content).toHaveLength(1)
    const para = doc.content[0]?.content ?? []
    // text, hardBreak, text
    expect(para).toHaveLength(3)
    expect(para[0]?.text).toBe('Line 1')
    expect(para[1]?.type).toBe('hardBreak')
    expect(para[2]?.text).toBe('Line 2')
  })

  it('ensureFooterAdf appends footer when missing', () => {
    const doc = ensureFooterAdf({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    })
    expect(doc.content).toHaveLength(2)
    expect(doc.content[1]?.content?.[0]?.text).toBe(HERMES_FOOTER)
  })

  it('ensureFooterAdf does not double-stamp', () => {
    const doc = ensureFooterAdf({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: HERMES_FOOTER }] }],
    })
    expect(doc.content).toHaveLength(1)
  })
})
