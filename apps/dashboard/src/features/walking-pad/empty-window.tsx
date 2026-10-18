import { Button } from '@mantine/core'
import { IconWalk } from '@tabler/icons-react'
import { EmptyState } from 'basalt-ui'
import { useNow } from '../../lib/use-now'
import { walkingStore } from '../../lib/window-stores'
import { useLastWalk } from './last-walk'
import { emptyWindowHint, widenLabel, widerPreset, windowPhrase } from './model'

/** The empty state under the dimmed strip: why nothing is drawn, what fills it, and the wider window. */
export function EmptyWindow() {
  const [range, setWindow] = walkingStore.field.window.use()
  const preset = range.preset
  const last = useLastWalk()
  const now = useNow()
  const wider = widerPreset(preset)
  const description = emptyWindowHint({ last, wider, nowMs: now })
  return (
    <EmptyState
      tier="section"
      icon={<IconWalk size={28} />}
      title={`No walks in ${windowPhrase(preset)}`}
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
