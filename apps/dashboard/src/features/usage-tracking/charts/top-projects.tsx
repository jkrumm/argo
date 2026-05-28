import { useSuspenseQuery } from '@tanstack/react-query'
import { Card, Group, Stack, Table, Text } from '@mantine/core'
import { usageQueries, type Range } from '../../../lib/queries/usage'
import { fmtPct, fmtUsd } from '../constants'

export default function TopProjects({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(
    usageQueries.breakdown({ range, metric: 'cost', dimension: 'project', limit: 10 }),
  )

  return (
    <Card padding="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="baseline">
          <Text fw={600}>Top projects (cost)</Text>
          <Text size="xs" c="dimmed">
            Total {fmtUsd(data.total)}
          </Text>
        </Group>
        {data.rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No data in this window.
          </Text>
        ) : (
          <Table striped highlightOnHover withRowBorders={false} verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Project</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Cost</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Share</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.map((r) => (
                <Table.Tr key={r.key}>
                  <Table.Td>
                    <Text size="sm">{r.key}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm">{fmtUsd(r.value)}</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text size="sm" c="dimmed">
                      {fmtPct(r.share)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  )
}
