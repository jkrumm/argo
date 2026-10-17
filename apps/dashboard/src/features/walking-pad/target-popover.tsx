import { ActionIcon, NumberInput, Popover } from '@mantine/core'
import { IconTarget } from '@tabler/icons-react'
import { SettingsRow } from 'basalt-ui'
import { walkingLocal } from './local-store'

/** The weekly distance target, edited from the THIS WEEK cell. Persisted on this device only. */
export function TargetPopover() {
  const [target, setTarget] = walkingLocal.field.weeklyTargetKm.use()
  return (
    <Popover position="bottom-start" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" aria-label={`Weekly target, ${target} km`}>
          <IconTarget />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <SettingsRow
          label="Weekly target"
          description="Distance per Mon–Sun week, kept on this device"
          control={
            <NumberInput
              aria-label="Weekly target in kilometres"
              value={target}
              onChange={(v) => {
                if (typeof v === 'number') setTarget(v)
              }}
              min={1}
              max={200}
              allowDecimal={false}
              suffix=" km"
            />
          }
        />
      </Popover.Dropdown>
    </Popover>
  )
}
