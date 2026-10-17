import { useState } from 'react'
import { Button, Group, NumberInput, Popover } from '@mantine/core'
import { emit } from 'basalt-ui/commands'
import { IconCheck } from '@tabler/icons-react'
import { useUpdateGoal } from '../use-update-goal'

/** "Set a goal": a one-field popover that PUTs `goal_weight_kg` to the profile. */
export function GoalPopover({ lastWeight }: { lastWeight: number | null }) {
  const [opened, setOpened] = useState(false)
  const [goal, setGoal] = useState<number | string>('')
  const update = useUpdateGoal()
  const valid = typeof goal === 'number' && goal >= 30 && goal <= 300

  function save() {
    if (typeof goal !== 'number' || !valid) return
    update.mutate(goal, {
      onSuccess: () => {
        setOpened(false)
        emit(
          'body-comp:save-success',
          { message: `${goal.toFixed(1)} kg` },
          { title: 'Goal set', icon: <IconCheck size={18} />, autoClose: 2000 },
        )
      },
      onError: (err) =>
        emit(
          'body-comp:save-error',
          { message: err instanceof Error ? err.message : 'Unknown error' },
          { title: 'Could not save goal' },
        ),
    })
  }

  return (
    <Popover opened={opened} onChange={setOpened} position="top-start" withArrow trapFocus>
      <Popover.Target>
        <Button variant="default" size="compact-sm" onClick={() => setOpened((o) => !o)}>
          Set a goal
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <NumberInput
            label="Goal weight (kg)"
            min={30}
            max={300}
            step={0.5}
            decimalScale={1}
            inputMode="decimal"
            placeholder={lastWeight === null ? undefined : lastWeight.toFixed(1)}
            value={goal}
            onChange={setGoal}
            data-autofocus
          />
          <Button onClick={save} disabled={!valid} loading={update.isPending}>
            Save
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}
