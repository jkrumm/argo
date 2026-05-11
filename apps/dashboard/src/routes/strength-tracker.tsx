import { createFileRoute } from '@tanstack/react-router'
import { Text, Title } from '@mantine/core'

export const Route = createFileRoute('/strength-tracker')({
  component: StrengthTrackerPage,
})

function StrengthTrackerPage() {
  return (
    <>
      <Title order={2} mb="md">
        Strength Tracker
      </Title>
      <Text c="dimmed">Data and charts coming in Group 9.</Text>
    </>
  )
}
