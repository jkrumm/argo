import { describe, it, expect } from 'bun:test'
import { UptimeKumaClient } from './uptime-kuma.js'

// ── Fake socket: records handlers so a test can fire Kuma events ─────────

type Handler = (...args: unknown[]) => void

function connectedClient() {
  const handlers = new Map<string, Handler>()
  const socket = {
    on: (event: string, fn: Handler) => handlers.set(event, fn),
    io: { on: () => undefined },
    emit: () => undefined,
  }
  const client = new UptimeKumaClient()
  // bindListeners is private; the fake socket stands in for the socket.io connection.
  client['bindListeners'](socket as never)
  return { client, fire: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args) }
}

const group = { id: 1, name: 'Samba', type: 'group', active: true, parent: null }
const child = {
  id: 2,
  name: 'Samba - Docker',
  type: 'docker',
  active: true,
  parent: 1,
}

function monitor(client: UptimeKumaClient, id: string) {
  return client.getSnapshot().monitors.find((m) => m.id === id)
}

describe('uptime-kuma client: parent', () => {
  it('maps parent from monitorList as a string, null for top-level', () => {
    const { client, fire } = connectedClient()
    fire('monitorList', { '1': group, '2': child })
    expect(monitor(client, '1')?.parent).toBeNull()
    expect(monitor(client, '2')?.parent).toBe('1')
  })

  it('takes parent from updateMonitorIntoList, including a move out of a group', () => {
    const { client, fire } = connectedClient()
    fire('monitorList', { '1': group, '2': child })
    fire('updateMonitorIntoList', { '2': { ...child, parent: null } })
    expect(monitor(client, '2')?.parent).toBeNull()
    fire('updateMonitorIntoList', { '2': { ...child, parent: 1 } })
    expect(monitor(client, '2')?.parent).toBe('1')
  })

  it('treats a missing parent as null', () => {
    const { client, fire } = connectedClient()
    const { parent: _parent, ...noParent } = group
    fire('monitorList', { '1': noParent })
    expect(monitor(client, '1')?.parent).toBeNull()
  })
})

describe('uptime-kuma client: msg and lastBeatAt', () => {
  it('is null before any heartbeat', () => {
    const { client, fire } = connectedClient()
    fire('monitorList', { '2': child })
    expect(monitor(client, '2')).toMatchObject({ msg: null, lastBeatAt: null })
  })

  it('takes the newest beat of heartbeatList; Kuma time is UTC', () => {
    const { client, fire } = connectedClient()
    fire('monitorList', { '2': child })
    fire('heartbeatList', 2, [
      { status: 1, ping: null, time: '2026-10-31 10:00:00.000', msg: 'old' },
      { status: 0, ping: null, time: '2026-10-31 10:05:30.250', msg: 'container exited' },
    ])
    expect(monitor(client, '2')).toMatchObject({
      status: 0,
      msg: 'container exited',
      lastBeatAt: '2026-10-31T10:05:30.250Z',
    })
  })

  it('a live heartbeat replaces msg and lastBeatAt; an empty msg becomes null', () => {
    const { client, fire } = connectedClient()
    fire('monitorList', { '2': child })
    fire('heartbeatList', 2, [{ status: 0, ping: null, time: '2026-10-31 10:05:30', msg: 'down' }])
    fire('heartbeat', { monitorID: 2, status: 1, ping: 12, time: '2026-10-31 10:06:00', msg: '' })
    expect(monitor(client, '2')).toMatchObject({
      status: 1,
      ping: 12,
      msg: null,
      lastBeatAt: '2026-10-31T10:06:00.000Z',
    })
  })

  it('a heartbeat without msg or with an unparseable time yields nulls', () => {
    const { client, fire } = connectedClient()
    fire('monitorList', { '2': child })
    fire('heartbeat', { monitorID: 2, status: 1, ping: 5, time: 'garbage' })
    expect(monitor(client, '2')).toMatchObject({ msg: null, lastBeatAt: null })
  })
})
