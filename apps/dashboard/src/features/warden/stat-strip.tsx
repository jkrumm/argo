import { Box, Card, Group, Text, Tooltip } from '@mantine/core'
import type { ReactNode } from 'react'
import classes from './stat-strip.module.css'

/** One strip cell: a mono caption, a headline (`value` + muted `unit`), a qualifier line and an
 * optional micro-visual. A cell without a reading passes `value="—"` and `qualifier="no data: …"`. */
export type StatStripCell = {
  key: string
  caption: string
  /** The definition behind the caption, shown on hover. */
  info?: string | undefined
  value: string
  unit?: string | undefined
  /** Ink for the headline (a status token), only when the reading is a verdict. */
  valueColor?: string | undefined
  qualifier?: ReactNode
  visual?: ReactNode
}

/**
 * StatStrip — prototype of the upstream `StatGroup variant="strip"` with a footer row
 * (docs/design/UPSTREAM.md): cells joined into one card, hairline-split, plus a footer of wider
 * cells (the budget meters). One column at 390, three at tablet, six at desktop.
 */
export function StatStrip({
  cells,
  footer,
}: {
  cells: readonly StatStripCell[]
  footer?: readonly { key: string; content: ReactNode }[]
}) {
  return (
    <Card py="sm" px="md">
      <Card.Section className={classes.strip}>
        <Box className={classes.cells}>
          {cells.map((cell) => (
            <Box key={cell.key} className={classes.cell} data-shot={`strip-${cell.key}`}>
              <Tooltip label={cell.info} disabled={!cell.info} multiline maw={260} withArrow>
                <Text size="xs" c="dimmed" ff="monospace" tt="uppercase" w="fit-content">
                  {cell.caption}
                </Text>
              </Tooltip>
              <Group gap={4} align="baseline" wrap="nowrap">
                <Text
                  fz="xl"
                  fw={600}
                  lh={1.1}
                  {...(cell.valueColor ? { c: cell.valueColor } : {})}
                >
                  {cell.value}
                </Text>
                {cell.unit ? (
                  <Text size="sm" c="dimmed">
                    {cell.unit}
                  </Text>
                ) : null}
              </Group>
              {cell.qualifier ? (
                <Text size="xs" c="dimmed">
                  {cell.qualifier}
                </Text>
              ) : null}
              {cell.visual}
            </Box>
          ))}
        </Box>
        {footer && footer.length > 0 ? (
          <Box className={classes.footer}>
            {footer.map((entry) => (
              <Box key={entry.key} className={classes.footerCell} data-shot={`budget-${entry.key}`}>
                {entry.content}
              </Box>
            ))}
          </Box>
        ) : null}
      </Card.Section>
    </Card>
  )
}
