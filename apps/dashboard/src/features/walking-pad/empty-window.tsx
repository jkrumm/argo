import { useQuery } from '@tanstack/react-query'
import { Button } from '@mantine/core'
import { IconWalk } from '@tabler/icons-react'
import { EmptyState } from 'basalt-ui'
import { date, relativeTime } from 'basalt-ui/format'
import { APP_LOCALE } from '../../lib/format'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { widenLabel, widerPreset, windowPhrase } from './model'

/** The one row a window with no walks renders: it names the window, the last walk and the wider window. */
export function EmptyWindow() {
  const [range, setWindow] = walkingStore.field.window.use()
  const preset = range.preset
  const last = useQuery(walkingPadQueries.list({ page: 1, limit: 1 }))
  const lastEndedAt = last.data?.data[0]?.ended_at
  const wider = widerPreset(preset)
  const description = last.isPending
    ? undefined
    : lastEndedAt === undefined
      ? 'No walk has been recorded yet.'
      : `Last walk ${date(lastEndedAt, { locale: APP_LOCALE })}, ${relativeTime(lastEndedAt)}.`
  return (
    <EmptyState
      tier="section"
      icon={<IconWalk size={28} />}
      title={
        lastEndedAt === undefined && !last.isPending
          ? 'No walks yet'
          : `No walks in ${windowPhrase(preset)}`
      }
      {...(description !== undefined && { description })}
      {...(wider !== null && {
        action: (
          <Button variant="default" onClick={() => setWindow({ preset: wider })}>
            {widenLabel(wider)}
          </Button>
        ),
      })}
    />
  )
}
