import { useQuery } from '@tanstack/react-query'
import { Button } from '@mantine/core'
import { IconWalk } from '@tabler/icons-react'
import { EmptyState } from 'basalt-ui'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { widenLabel, widerPreset, windowPhrase } from './model'

/** The empty state under the dimmed strip: why nothing is drawn, what fills it, and the wider window. */
export function EmptyWindow() {
  const [range, setWindow] = walkingStore.field.window.use()
  const preset = range.preset
  const last = useQuery(walkingPadQueries.list({ page: 1, limit: 1 }))
  const lastEndedAt = last.data?.data[0]?.ended_at
  const wider = widerPreset(preset)
  const known = !last.isPending && !last.isError
  const never = known && lastEndedAt === undefined
  const description = never
    ? 'The strip fills after the first walk is recorded.'
    : `The strip fills once a walk is recorded in this window${wider === null ? '.' : `; widen it to reach ${last.isError ? 'earlier walks' : 'the last one'}.`}`
  return (
    <EmptyState
      tier="section"
      icon={<IconWalk size={28} />}
      title={never ? 'No walks yet' : `No walks in ${windowPhrase(preset)}`}
      description={description}
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
