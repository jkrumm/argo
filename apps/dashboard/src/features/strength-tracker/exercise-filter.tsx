import { Box, Button, Group } from '@mantine/core'
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
              <Box
                component="span"
                w={8}
                h={8}
                bdrs="50%"
                bg={EXERCISE_COLORS[ex.value]}
                style={{ display: 'inline-block' }}
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
