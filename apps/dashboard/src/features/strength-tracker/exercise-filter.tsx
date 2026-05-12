import { Button, Group } from '@mantine/core'
import { EXERCISES, EXERCISE_COLORS, type ExerciseKey } from './constants'

export function ExerciseFilter({
  active,
  onToggle,
}: {
  active: ReadonlyArray<ExerciseKey>
  onToggle: (next: ExerciseKey) => void
}) {
  return (
    <Group gap={4}>
      {EXERCISES.map((ex) => {
        const isOn = active.includes(ex.value)
        return (
          <Button
            key={ex.value}
            size="xs"
            variant="default"
            onClick={() => onToggle(ex.value)}
            styles={{ root: { opacity: isOn ? 1 : 0.45 } }}
            leftSection={
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: EXERCISE_COLORS[ex.value],
                }}
              />
            }
          >
            {ex.label}
          </Button>
        )
      })}
    </Group>
  )
}
