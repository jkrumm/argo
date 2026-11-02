/**
 * The Flow tab's small shared pieces: a selectable row, a card that is itself one node, a stacked
 * segment bar with its legend, and the column header. Selection is a store write (`?node=`), so every
 * piece takes `selected` and `onSelect` and owns no state.
 */
import type { ReactNode } from 'react'
import { Box, Button, Flex, Group, Text, UnstyledButton } from '@mantine/core'
import { ChartCard, type ChartFact } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import classes from './flow.module.css'

/** A row of a Flow card that selects its node; the selected row keeps its tint. */
export function FlowRow({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean
  onSelect: () => void
  /** The accessible name: what the row opens. */
  label: string
  children: ReactNode
}) {
  return (
    <UnstyledButton
      className={classes.row}
      data-selected={selected}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
    >
      {children}
    </UnstyledButton>
  )
}

/** A card that is one node (the router's cards, the IU key): its button opens or closes the detail. */
export function NodeCard({
  selected,
  onSelect,
  title,
  subtitle,
  facts,
  info,
  shot,
  children,
}: {
  selected: boolean
  /** Absent for a card that is part of a node another card opens: it takes the ring, not a button. */
  onSelect?: (() => void) | undefined
  title: string
  subtitle?: string | undefined
  /** The headline figure and its period: the card's basis line (a narrow card folds a subtitle into its info glyph). */
  facts?: ChartFact | readonly ChartFact[] | undefined
  info?: string | undefined
  shot: string
  children: ReactNode
}) {
  return (
    <Box data-shot={shot} data-shot-states="empty">
      <ChartCard
        {...(selected ? { className: classes.selected } : {})}
        title={title}
        {...(subtitle === undefined ? {} : { subtitle })}
        {...(facts === undefined ? {} : { facts })}
        {...(info === undefined ? {} : { info })}
        placeholderHeight="content"
        {...(onSelect === undefined
          ? {}
          : {
              actions: (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  aria-pressed={selected}
                  aria-label={`${selected ? 'Close' : 'Open'} the ${title} detail`}
                  onClick={onSelect}
                >
                  {selected ? 'Close' : 'Details'}
                </Button>
              ),
            })}
      >
        {children}
      </ChartCard>
    </Box>
  )
}

/** The header of a column of cards: its name and its window, then a thin rule running on to the next column. */
export function ColumnHeader({
  name,
  window,
  last = false,
}: {
  name: string
  window: string
  last?: boolean
}) {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
        {name} · {window}
      </Text>
      {last ? null : (
        <>
          <Box flex={1} h={1} bg={VX.divider} />
          <Text size="sm" className={classes.chevron} aria-hidden>
            ›
          </Text>
        </>
      )}
    </Group>
  )
}

export interface Segment {
  key: string
  label: string
  value: number
  color: string
}

/**
 * One thin stacked bar: each segment takes its share of the row, and `scale` (when given) is what the
 * whole bar is a share of, so rows of one list read against the same end.
 */
export function SegmentBar({
  segments,
  scale,
  height = 8,
}: {
  segments: readonly Segment[]
  /** The value the full row stands for; the bar fills `sum / scale` of it. Default: the segments' own sum. */
  scale?: number | undefined
  height?: number
}) {
  const parts = segments.filter((s) => s.value > 0)
  const sum = parts.reduce((acc, s) => acc + s.value, 0)
  const rest = scale === undefined ? 0 : Math.max(0, scale - sum)
  return (
    <Flex
      gap={2}
      h={height}
      role="img"
      aria-label={parts.map((s) => `${s.label} ${s.value}`).join(', ')}
    >
      {parts.map((s) => (
        <Box key={s.key} flex={s.value} bg={s.color} bdrs="xs" className={classes.segment} />
      ))}
      {rest > 0 ? <Box flex={rest} /> : null}
    </Flex>
  )
}

/** The names of a bar's segments, a swatch each. */
export function SegmentLegend({ segments }: { segments: readonly Omit<Segment, 'value'>[] }) {
  return (
    <Group gap="sm" wrap="wrap">
      {segments.map((s) => (
        <Group key={s.key} gap={4} wrap="nowrap">
          <Box w={8} h={8} bg={s.color} bdrs="xs" />
          <Text size="xs" c="dimmed">
            {s.label}
          </Text>
        </Group>
      ))}
    </Group>
  )
}
