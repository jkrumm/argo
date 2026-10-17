import { useQuery } from '@tanstack/react-query'
import { Button, Card, Group, Skeleton, Stack, Text } from '@mantine/core'
import { WidgetHeader, useSizeClass } from 'basalt-ui'
import { APP_LOCALE } from '../../lib/format'
import { walkingPadQueries } from '../../lib/queries/walking-pad'
import { walkingLocal } from './local-store'
import { collapseAchievements, groupByMonth, type AchievementRow } from './model'

const dayFormat = new Intl.DateTimeFormat(APP_LOCALE, { day: 'numeric', month: 'short' })

const VISIBLE = 6
const VISIBLE_COMPACT = 3
/** The API's page cap; the heading count is the sum of the rows' repeats, so it needs every unlock. */
const FETCH_LIMIT = 200

function Row({ row }: { row: AchievementRow }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" align="baseline">
      <Text size="sm" fw={500} truncate flex={1}>
        {row.title}
        {row.count > 1 && (
          <Text span size="sm" c="dimmed">
            {' '}
            ×{row.count}
          </Text>
        )}
      </Text>
      <Text size="xs" c="dimmed" flex="none">
        {row.count > 1 ? 'last ' : ''}
        {dayFormat.format(new Date(row.lastAt))}
      </Text>
    </Group>
  )
}

export function AchievementsList() {
  const query = useQuery(walkingPadQueries.achievements({ limit: FETCH_LIMIT }))
  const [showAll, setShowAll] = walkingLocal.field.showAllAchievements.use()
  const compact = useSizeClass() === 'compact'
  const items = query.data?.data ?? []
  const rows = collapseAchievements(items)
  const limit = compact ? VISIBLE_COMPACT : VISIBLE
  const shown = showAll ? rows : rows.slice(0, limit)

  return (
    <Card py="sm" px="md">
      <WidgetHeader
        tier="widget"
        title="Achievements"
        {...(query.isSuccess && { count: items.length })}
      />
      {query.isPending ? (
        <Skeleton height={120} />
      ) : rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          None unlocked yet. The first walk unlocks one.
        </Text>
      ) : (
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            {items.length} unlocks in {rows.length} titles
          </Text>
          {groupByMonth(shown).map((g) => (
            <Stack key={g.month} gap="xs">
              <Text size="xs" c="dimmed" ff="monospace" tt="uppercase">
                {g.month}
              </Text>
              {g.rows.map((r) => (
                <Row key={r.title} row={r} />
              ))}
            </Stack>
          ))}
          {rows.length > limit && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show fewer' : `Show all ${rows.length} titles`}
            </Button>
          )}
        </Stack>
      )}
    </Card>
  )
}
