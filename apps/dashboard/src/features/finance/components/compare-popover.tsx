import { Badge, Button, CloseButton, Menu, Text } from '@mantine/core'
import { IconChevronDown, IconGitCompare } from '@tabler/icons-react'
import type { IndexSeries } from '../lib/index-series'
import { signedPercent } from '../lib/depot-chart'
import type { RangeChange } from '../lib/depot-chart'
import classes from './depot.module.css'

/**
 * "Compare with…" in the chart's bottom toolbar: a menu of the stored indices. Once one is picked the chart draws it
 * as a percent line against the instrument, and a chip names it with its change over the visible range and an x
 * that removes it.
 */
export function ComparePopover({
  options,
  value,
  name,
  change,
  onPick,
}: {
  options: readonly IndexSeries[]
  value: string
  /** What the instrument is called in "…vs. Name +4,1 %". */
  name: string
  /** Both lines' change over the visible range, once the chart has reported it. */
  change: RangeChange | null
  onPick: (id: string) => void
}) {
  const picked = options.find((option) => option.id === value)
  return (
    <>
      {picked !== undefined && (
        <Badge
          className={classes.chip}
          variant="default"
          size="lg"
          data-shot="depot-compare-chip"
          rightSection={
            <CloseButton
              size="xs"
              aria-label={`Remove the comparison with ${picked.name}`}
              onClick={() => onPick('')}
            />
          }
        >
          {picked.name}
          {change?.other != null && ` ${signedPercent(change.other)}`}
        </Badge>
      )}
      {picked !== undefined && change?.own != null && (
        <Text size="xs" c="dimmed" className={classes.chipNote}>
          {name} {signedPercent(change.own)}
        </Text>
      )}
      <Menu position="top-end" withinPortal>
        <Menu.Target>
          <Button
            variant="default"
            color="gray"
            leftSection={<IconGitCompare size={16} />}
            rightSection={<IconChevronDown size={14} />}
            aria-label="Compare with an index"
          >
            Compare with…
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {options.map((option) => (
            <Menu.Item
              key={option.id}
              aria-current={option.id === value}
              fw={option.id === value ? 600 : undefined}
              onClick={() => onPick(option.id === value ? '' : option.id)}
            >
              {option.name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </>
  )
}
