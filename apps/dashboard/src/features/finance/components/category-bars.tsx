import { Box, Text } from '@mantine/core'
import { NONE, topLabel } from '../lib/categories'
import { eur } from '../lib/format'
import type { CategoryLine } from '../lib/pace'
import type { Category } from '../api/types'
import classes from './finance.module.css'

type CategoryBarsProps = {
  lines: readonly CategoryLine[]
  categories: readonly Category[] | undefined
  /** Draw the first `limit` lines; the rest fold into one "Everything else" line. */
  limit?: number
  /** The month is still running: its figures read as a share of the usual month, not as a difference. */
  partial?: boolean
}

const share = (value: number, max: number): number => (max <= 0 ? 0 : Math.min(value / max, 1))

/**
 * Spending per top category against its usual month: the fill is this month, the tick the average,
 * the figure beside it the delta. Over the average reads in the danger ink, so over/under is a
 * word and a number, never colour alone. All rows share one scale.
 */
export function CategoryBars({ lines, categories, limit = 8, partial = false }: CategoryBarsProps) {
  const shown = lines.slice(0, limit)
  const rest = lines.slice(limit)
  const folded: CategoryLine[] =
    rest.length === 0
      ? []
      : [
          {
            key: '__rest__',
            current: rest.reduce((s, l) => s + l.current, 0),
            average: rest.reduce((s, l) => s + l.average, 0),
            delta: rest.reduce((s, l) => s + l.delta, 0),
          },
        ]
  const all = [...shown, ...folded]
  const max = Math.max(...all.flatMap((l) => [l.current, l.average]), 1)

  return (
    <Box
      className={classes.cats}
      role="list"
      aria-label="Spending per category against the average"
    >
      {all.map((line) => {
        const label =
          line.key === '__rest__'
            ? `${rest.length} more categories`
            : topLabel(categories, line.key === NONE ? null : line.key)
        const over = line.current > line.average && line.average > 0
        return (
          <Box key={line.key} className={classes.cat} role="listitem">
            <Text size="sm" className={classes.catName} title={label}>
              {label}
            </Text>
            <Text size="sm" className={classes.catFigures}>
              {line.current === 0 ? '—' : eur(line.current)}
              <Text span size="xs" c="dimmed">
                {' '}
                {line.average === 0
                  ? 'new'
                  : partial
                    ? `of ${eur(line.average)}`
                    : `${line.delta > 0 ? '▲' : line.delta < 0 ? '▼' : ''} ${eur(Math.abs(line.delta))}`.trim()}
              </Text>
            </Text>
            <Box
              className={classes.track}
              style={{ '--share': share(line.current, max), '--avg': share(line.average, max) }}
            >
              <Box className={`${classes.fill} ${over ? classes.fillOver : ''}`} />
              {line.average > 0 && <Box className={classes.avgTick} />}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
