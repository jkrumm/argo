import { useQuery } from '@tanstack/react-query'
import { Button } from '@mantine/core'
import { IconWalk } from '@tabler/icons-react'
import { EmptyState } from 'basalt-ui'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { widenLabel, widerPreset } from './model'

/** The empty state under the dimmed strip: why nothing is drawn, what fills it, and the wider window. */
export function EmptyWindow() {
  const [range, setWindow] = walkingStore.field.window.use()
  const preset = range.preset
  const last = useQuery(walkingPadQueries.list({ page: 1, limit: 1 }))
  const lastEndedAt = last.data?.data[0]?.ended_at
  const wider = widerPreset(preset)
  const description =
    lastEndedAt === undefined && !last.isPending
      ? 'The strip and charts fill after the first walk is recorded.'
      : 'The strip and charts fill once a walk is recorded in this window; widen it to reach the last one.'
  return (
    <EmptyState
      tier="section"
      icon={<IconWalk size={28} />}
      title="No data to chart in this window"
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
