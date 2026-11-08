import { describe, expect, it } from 'bun:test'
import { JiraHttpError } from './jira.js'
import { graphStatusFromText, M365UpstreamError } from './m365.js'

describe('upstream status mapping', () => {
  it('reads a Graph status from tool text, never from a key like EP-1404', () => {
    expect(graphStatusFromText('Graph request failed with status 404: not found')).toBe(404)
    expect(graphStatusFromText('HTTP 401 Unauthorized')).toBe(401)
    expect(graphStatusFromText('{"error":{"code":"ResourceNotFound"}}')).toBe(404)
    expect(graphStatusFromText('Issue EP-1404 unauthorized')).toBeUndefined()
  })

  it('carries .status on the typed errors', () => {
    expect(new M365UpstreamError(404, 'x').status).toBe(404)
    expect(new JiraHttpError(401, 'nope', '/issue/EP-1404').status).toBe(401)
  })
})
