import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const CLIENT_ID = env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = env.GOOGLE_OAUTH_REDIRECT_URI
const SCOPES = [
  // openid + email are required to read userinfo for the allowlist check
  // in assertEmailAllowed. Both are basic (non-sensitive) scopes — no
  // Google verification needed.
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

const DATA_DIR = env.DATA_DIR
const TOKEN_FILE = join(DATA_DIR, 'oauth-tokens.json')

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // unix ms
}

interface TokenStore {
  google?: GoogleTokens
}

function loadTokens(): TokenStore {
  if (!existsSync(TOKEN_FILE)) return {}
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')) as TokenStore
}

function saveTokens(store: TokenStore): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2))
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

const ALLOWED_EMAILS = env.GOOGLE_ALLOWED_EMAIL.split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry.length > 0)

async function assertEmailAllowed(accessToken: string): Promise<void> {
  if (ALLOWED_EMAILS.length === 0) return
  // OpenID Connect endpoint — works with `openid email` scopes (which are
  // requested in SCOPES above). Returns 401 if the token lacks the scope.
  const res = await tracedFetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(
      `Identity verification failed: userinfo returned ${res.status} ${res.statusText}. ` +
        `Body: ${(await res.text()).slice(0, 200)}`,
    )
  }
  const { email } = (await res.json()) as { email?: string }
  if (!email || !ALLOWED_EMAILS.includes(email.toLowerCase())) {
    throw new Error(
      `Account ${email ?? 'unknown'} is not authorized for this app. ` +
        `Permitted accounts are configured via GOOGLE_ALLOWED_EMAIL.`,
    )
  }
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await tracedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  // Verify identity before persisting — protects against an attacker who
  // discovers the OAuth client_id and tries to overwrite our tokens with
  // their own grant.
  await assertEmailAllowed(data.access_token)
  const store = loadTokens()
  store.google = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  saveTokens(store)
}

async function refreshAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  const res = await tracedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

async function getValidAccessToken(): Promise<string> {
  const store = loadTokens()
  if (!store.google)
    throw new Error('Google not authenticated — visit /oauth/google/init in a browser')
  let tokens = store.google
  if (Date.now() >= tokens.expiresAt - 5 * 60 * 1000) {
    tokens = await refreshAccessToken(tokens)
    store.google = tokens
    saveTokens(store)
  }
  return tokens.accessToken
}

// ---------- Calendar ----------

interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
}

interface CalendarEvent {
  id: string
  summary?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  location?: string
  organizer?: { displayName?: string; email?: string }
  attendees?: Array<{
    displayName?: string
    email?: string
    responseStatus?: string
  }>
  hangoutLink?: string
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>
  }
}

function extractVideoLink(event: CalendarEvent): string | undefined {
  if (event.hangoutLink) return event.hangoutLink
  return event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
}

export interface CalendarEventItem {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location?: string
  organizer?: { name: string; email: string }
  attendees: Array<{ name: string; email: string; status: string }>
  calendarName: string
  videoLink?: string
}

export async function listCalendarEvents(days: number = 30): Promise<CalendarEventItem[]> {
  const token = await getValidAccessToken()

  const calRes = await tracedFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!calRes.ok) throw new Error(`Calendar list failed: ${await calRes.text()}`)
  const calData = (await calRes.json()) as { items: CalendarListEntry[] }
  const calendars = calData.items ?? []

  const now = new Date()
  const timeMin = now.toISOString()
  const timeMax = new Date(now.getTime() + days * 86400 * 1000).toISOString()

  const allEvents: CalendarEventItem[] = []

  await Promise.all(
    calendars.map(async (cal) => {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      })
      const evRes = await tracedFetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!evRes.ok) return
      const evData = (await evRes.json()) as { items: CalendarEvent[] }
      for (const ev of evData.items ?? []) {
        const isAllDay = Boolean(ev.start.date && !ev.start.dateTime)
        const videoLink = extractVideoLink(ev)
        allEvents.push({
          id: ev.id,
          title: ev.summary ?? '(no title)',
          start: ev.start.dateTime ?? ev.start.date ?? '',
          end: ev.end.dateTime ?? ev.end.date ?? '',
          isAllDay,
          ...(ev.location !== undefined ? { location: ev.location } : {}),
          ...(ev.organizer?.email
            ? { organizer: { name: ev.organizer.displayName ?? '', email: ev.organizer.email } }
            : {}),
          attendees: (ev.attendees ?? []).map((a) => ({
            name: a.displayName ?? '',
            email: a.email ?? '',
            status: a.responseStatus ?? 'unknown',
          })),
          calendarName: cal.summary,
          ...(videoLink !== undefined ? { videoLink } : {}),
        })
      }
    }),
  )

  return allEvents.sort((a, b) => a.start.localeCompare(b.start))
}
