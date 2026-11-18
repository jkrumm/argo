import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { StatGroup, type StatStripCell } from 'basalt-ui'
import { NBSP, formatAgo } from '../../lib/format'
import { lineQueries } from '../../lib/queries/line'
import { useNow } from '../../lib/use-now'
import { lineStore } from '../../lib/window-stores'
import {
  WINDOW_NOUN,
  durationText,
  formatDb,
  formatMbit,
  formatMs,
  formatUptime,
  verdict,
} from './model'

/** A failed query is its own cell's error state, with a retry, and no other cell's. */
const errorState = (q: UseQueryResult): NonNullable<StatStripCell['state']> => ({
  kind: 'error',
  error: q.error,
  onRetry: () => void q.refetch(),
  retrying: q.isFetching,
})

/** Is the line up now, how has it been over the window, and what does it deliver: four cells, no scrolling. */
export function LineStrip() {
  const { window } = lineStore.useValues()
  const now = useNow()
  const current = useQuery(lineQueries.now())
  const uptime = useQuery(lineQueries.uptime(window))
  const n = current.data
  const u = uptime.data

  const nowCell: StatStripCell = (() => {
    const base = { key: 'now', caption: 'Internet', loading: current.isPending }
    if (current.isError && n === undefined) return { ...base, state: errorState(current) }
    if (n === undefined) return base
    const v = verdict(n.state, n.probeAt, n.ongoingSince, now)
    const last = n.lastOutage
    return {
      ...base,
      qualifier: v.phrase,
      value: v.word,
      ...(v.tone && { tone: v.tone }),
      footer:
        last === null
          ? 'no outage on record'
          : `last outage ${formatAgo(now - last.end * 1000)}${NBSP}· ${durationText(last.durationS)}`,
    }
  })()

  const uptimeCell: StatStripCell = (() => {
    const base = {
      key: 'uptime',
      caption: 'Uptime',
      qualifier: WINDOW_NOUN[window],
      loading: uptime.isPending,
    }
    if (uptime.isError && u === undefined) return { ...base, state: errorState(uptime) }
    if (u === undefined) return base
    return {
      ...base,
      value: formatUptime(u.uptimePct),
      unit: '%',
      rows: [
        {
          key: 'down',
          label: 'Down',
          value: u.downtimeS === 0 ? '0 min' : durationText(u.downtimeS),
        },
        { key: 'outages', label: 'Outages', value: String(u.outages.length) },
      ],
    }
  })()

  const router = n?.router ?? null
  const lineCell: StatStripCell = (() => {
    const base = {
      key: 'line',
      caption: 'Line',
      qualifier: 'G.fast sync',
      loading: current.isPending,
    }
    if (current.isError && n === undefined) return { ...base, state: errorState(current) }
    if (n === undefined) return base
    if (router === null)
      return { ...base, state: { kind: 'empty' as const, reason: 'No router reading yet' } }
    return {
      ...base,
      value: formatMbit(router.syncDownMbit),
      unit: 'Mbit/s down',
      rows: [
        { key: 'up', label: 'Up', value: `${formatMbit(router.syncUpMbit)}${NBSP}Mbit/s` },
        {
          key: 'noise',
          label: 'Noise margin',
          value: `${formatDb(router.noiseDownDb)} / ${formatDb(router.noiseUpDb)}${NBSP}dB`,
        },
      ],
    }
  })()

  const test = n?.speedTest ?? null
  const speedCell: StatStripCell = (() => {
    const base = { key: 'speed', caption: 'Speed test', loading: current.isPending }
    if (current.isError && n === undefined) return { ...base, state: errorState(current) }
    if (n === undefined) return base
    if (test === null)
      return { ...base, state: { kind: 'empty' as const, reason: 'No speed test this week' } }
    return {
      ...base,
      qualifier: formatAgo(now - test.at * 1000),
      value: formatMbit(test.downloadMbit),
      unit: 'Mbit/s down',
      rows: [
        { key: 'up', label: 'Up', value: `${formatMbit(test.uploadMbit)}${NBSP}Mbit/s` },
        { key: 'ping', label: 'Ping', value: `${formatMs(test.pingMs)}${NBSP}ms` },
      ],
    }
  })()

  return (
    <StatGroup
      variant="strip"
      label="Internet line now"
      cells={[nowCell, uptimeCell, lineCell, speedCell]}
    />
  )
}
