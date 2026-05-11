import { createFileRoute } from '@tanstack/react-router'
import { Text, Title } from '@mantine/core'

export const Route = createFileRoute('/garmin-health')({
  component: GarminHealthPage,
})

function GarminHealthPage() {
  return (
    <>
      <Title order={2} mb="md">
        Garmin Health
      </Title>
      <Text c="dimmed">Data and charts coming in Group 8.</Text>
    </>
  )
}
