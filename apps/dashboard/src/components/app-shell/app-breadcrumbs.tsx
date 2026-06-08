import { Group, Text } from '@mantine/core'

/**
 * Slim top-bar breadcrumb: `Section / Page`. Section is muted (nav context), page is emphasized
 * (current location). Derived from the active nav item in `__root.tsx` — no separate route table.
 */
export function AppBreadcrumbs({ section, page }: { section?: string; page?: string }) {
  if (!page) return null
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      {section && (
        <>
          <Text size="sm" c="dimmed" truncate>
            {section}
          </Text>
          <Text size="sm" c="dimmed">
            /
          </Text>
        </>
      )}
      <Text size="sm" fw={600} truncate>
        {page}
      </Text>
    </Group>
  )
}
