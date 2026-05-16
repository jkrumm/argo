/* eslint-disable no-console */
/**
 * Smoke test for the M365 Teams/chats functions (src/clients/m365.ts).
 *
 * Run from repo root:
 *   DATABASE_URL='postgresql://noop@localhost:5432/noop' \
 *     op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
 *     bun run --cwd apps/api scripts/m365-smoke-teams.ts
 */
import {
  listChannelMessages,
  listChatMessages,
  listChats,
  listJoinedTeams,
  listTeamChannels,
} from '../src/clients/m365.js'

async function section<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n══ ${label}`)
  try {
    return await fn()
  } catch (e) {
    console.error(`  ERROR: ${(e as Error).message}`)
    return undefined
  }
}

function brief(...lines: string[]): void {
  for (const l of lines) console.log(`  ${l}`)
}

const teams = await section('listJoinedTeams()', () => listJoinedTeams())
if (teams) {
  brief(`count=${teams.length}`)
  for (const t of teams.slice(0, 8)) brief(`  ${t.id.padEnd(40)} ${t.displayName}`)
}

const firstTeamId = teams?.[0]?.id
if (firstTeamId) {
  const channels = await section(`listTeamChannels("${firstTeamId}")`, () =>
    listTeamChannels(firstTeamId),
  )
  if (channels) {
    brief(`count=${channels.length}`)
    for (const c of channels.slice(0, 8))
      brief(`  ${c.id.slice(0, 50).padEnd(50)} [${c.membershipType}] ${c.displayName}`)
    const firstChannelId = channels[0]?.id
    if (firstChannelId) {
      const msgs = await section(`listChannelMessages({ teamId, channelId, top: 5 })`, () =>
        listChannelMessages({
          teamId: firstTeamId,
          channelId: firstChannelId,
          top: 5,
        }),
      )
      if (msgs) {
        brief(`count=${msgs.length}`)
        for (const m of msgs)
          brief(
            `  ${(m.createdAt ?? '').slice(0, 19)} from=${m.from?.name ?? 'system'} replies=${m.replyCount} text="${m.bodyText.slice(0, 60).replace(/\n/g, ' ')}"`,
          )
      }
    }
  }
}

const chats = await section('listChats({ top: 5 })', () => listChats({ top: 5 }))
if (chats) {
  brief(`count=${chats.length}`)
  for (const c of chats) {
    const label =
      c.topic ??
      c.members
        .map((m) => m.name)
        .join(', ')
        .slice(0, 50)
    brief(
      `  ${c.chatType.padEnd(10)} ${(c.lastUpdatedAt ?? '').slice(0, 19)} members=${c.members.length} | ${label}`,
    )
    if (c.lastMessagePreview)
      brief(
        `    last: ${c.lastMessagePreview.from ?? '?'}: "${c.lastMessagePreview.text.slice(0, 60).replace(/\n/g, ' ')}"`,
      )
  }
  const firstChatId = chats[0]?.id
  if (firstChatId) {
    const msgs = await section(`listChatMessages({ chatId, top: 3 })`, () =>
      listChatMessages({ chatId: firstChatId, top: 3 }),
    )
    if (msgs) {
      brief(`count=${msgs.length}`)
      for (const m of msgs)
        brief(
          `  ${(m.createdAt ?? '').slice(0, 19)} from=${m.from?.name ?? 'system'} text="${m.bodyText.slice(0, 60).replace(/\n/g, ' ')}"`,
        )
    }
  }
}

console.log('\nDone.')
