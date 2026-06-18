import { Center, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconBooks } from '@tabler/icons-react'

export function EmptyShelf() {
  return (
    <Center py={64}>
      <Stack align="center" gap="md">
        <ThemeIcon size={56} variant="light" color="gray" radius="xl">
          <IconBooks size={28} />
        </ThemeIcon>
        <Stack align="center" gap={4}>
          <Text fw={600} size="lg">
            Your shelf is empty
          </Text>
          <Text size="sm" c="dimmed" ta="center" maw={360}>
            Books appear here once you add them to your shelf on Hardcover. Sync runs daily.
          </Text>
        </Stack>
      </Stack>
    </Center>
  )
}
