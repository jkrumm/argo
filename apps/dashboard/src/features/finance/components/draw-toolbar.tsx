import { ActionIcon, Box, Tooltip } from '@mantine/core'
import {
  IconBorderHorizontal,
  IconBorderVertical,
  IconPointer,
  IconRulerMeasure,
  IconTrash,
} from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type { ColorRole } from '../lib/depot-chart'
import { ColourSwatches } from './colour-swatches'
import type { DrawTool } from './depot-chart'
import classes from './depot.module.css'

/** The tools, each with the name its tooltip and its label carry. A horizontal line marks a price, a vertical one a day. */
const TOOLS: readonly { tool: DrawTool; label: string; icon: ReactNode }[] = [
  {
    tool: 'horizontal-line',
    label: 'Horizontal line: marks a price',
    icon: <IconBorderHorizontal />,
  },
  { tool: 'vertical-line', label: 'Vertical line: marks a day', icon: <IconBorderVertical /> },
  { tool: 'price-range', label: 'Price range: measures a move', icon: <IconRulerMeasure /> },
]

/**
 * The one drawing toolbar of the chart: the pointer, the three tools, the colour for the next line (and the
 * selected one) and delete. A tool is used once and the pointer comes back.
 */
export function DrawToolbar({
  tool,
  armed,
  role,
  canDelete,
  onTool,
  onRole,
  onDelete,
}: {
  tool: DrawTool | null
  armed: boolean
  role: ColorRole
  canDelete: boolean
  onTool: (tool: DrawTool | null) => void
  onRole: (role: ColorRole) => void
  onDelete: () => void
}) {
  return (
    <Box
      className={classes.drawTools}
      role="toolbar"
      aria-label="Drawing tools"
      data-shot="depot-draw-tools"
    >
      <Tooltip label="Pointer: select and move" openDelay={250} withArrow>
        <ActionIcon
          variant={tool === null ? 'filled' : 'default'}
          color="gray"
          aria-label="Pointer"
          aria-pressed={tool === null}
          disabled={!armed}
          onClick={() => onTool(null)}
        >
          <IconPointer />
        </ActionIcon>
      </Tooltip>
      {TOOLS.map((entry) => (
        <Tooltip key={entry.tool} label={entry.label} openDelay={250} withArrow>
          <ActionIcon
            variant={tool === entry.tool ? 'filled' : 'default'}
            color="gray"
            aria-label={entry.label.split(':')[0] ?? entry.label}
            aria-pressed={tool === entry.tool}
            disabled={!armed}
            onClick={() => onTool(entry.tool)}
          >
            {entry.icon}
          </ActionIcon>
        </Tooltip>
      ))}
      <Box className={classes.separator} aria-hidden />
      <ColourSwatches value={role} onPick={onRole} />
      <Box className={classes.separator} aria-hidden />
      <Tooltip label="Delete the selected drawing" openDelay={250} withArrow>
        <ActionIcon
          variant="default"
          aria-label="Delete the selected drawing"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <IconTrash />
        </ActionIcon>
      </Tooltip>
    </Box>
  )
}
