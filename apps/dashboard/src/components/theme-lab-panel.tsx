import {
  ActionIcon,
  Button,
  ColorInput,
  Divider,
  Group,
  ScrollArea,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCopy, IconRefresh } from '@tabler/icons-react'
import { useState } from 'react'
import { BP } from '@argo/charts'
import {
  AREA_BOTTOM_VAR,
  AREA_TOP_VAR,
  COLOR_GROUPS,
  applyOverrides,
  loadOverrides,
  readVar,
  saveOverrides,
  type Overrides,
} from '../lib/theme-lab'

/** Quick-pick Blueprint swatches (mid stop of each family) for the color inputs. */
const SWATCHES: string[] = [
  BP.blue[2],
  BP.cerulean[2],
  BP.turquoise[2],
  BP.forest[2],
  BP.green[2],
  BP.lime[2],
  BP.gold[2],
  BP.orange[2],
  BP.vermilion[2],
  BP.red[2],
  BP.rose[2],
  BP.violet[2],
  BP.indigo[2],
  BP.gray[2],
]

const pct = (v: string): number => Number.parseInt(v, 10) || 0

/**
 * Theme lab controls — the body shown inside the dev dock's theme popover. Retunes chart
 * colors + gradient strength live by overriding `--vx-*` on <html> (see lib/theme-lab.ts).
 * Persisted overrides are re-applied on page load by the DevDock, so this component owns
 * only the editing UI, not the initial apply.
 */
export function ThemeLabControls() {
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides())

  const setVar = (name: string, value: string) => {
    setOverrides((prev) => {
      const next = { ...prev, [name]: value }
      applyOverrides(next)
      saveOverrides(next)
      return next
    })
  }

  const resetAll = () => {
    setOverrides({})
    applyOverrides({})
    saveOverrides({})
  }

  const copyJson = () => {
    void navigator.clipboard.writeText(JSON.stringify(overrides, null, 2))
    notifications.show({ message: 'Theme overrides copied as JSON', color: 'blue' })
  }

  const valueOf = (name: string): string => overrides[name] ?? readVar(name)

  return (
    <Stack gap="xs" w={300}>
      <Group justify="space-between">
        <Text fw={600} size="sm">
          Theme Lab
        </Text>
        <Group gap={4}>
          <Tooltip label="Copy overrides as JSON">
            <ActionIcon variant="subtle" size="sm" onClick={copyJson} aria-label="Copy JSON">
              <IconCopy size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Reset all">
            <ActionIcon variant="subtle" size="sm" onClick={resetAll} aria-label="Reset all">
              <IconRefresh size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <ScrollArea.Autosize mah="68vh" type="hover" offsetScrollbars>
        <Stack gap="sm" pr="xs">
          <Stack gap={4}>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">
              Area gradient
            </Text>
            <Text size="xs" c="dimmed">
              Top {pct(valueOf(AREA_TOP_VAR))}%
            </Text>
            <Slider
              size="sm"
              min={0}
              max={50}
              value={pct(valueOf(AREA_TOP_VAR))}
              onChange={(v) => setVar(AREA_TOP_VAR, `${v}%`)}
            />
            <Text size="xs" c="dimmed">
              Bottom {pct(valueOf(AREA_BOTTOM_VAR))}%
            </Text>
            <Slider
              size="sm"
              min={0}
              max={20}
              value={pct(valueOf(AREA_BOTTOM_VAR))}
              onChange={(v) => setVar(AREA_BOTTOM_VAR, `${v}%`)}
            />
          </Stack>

          {COLOR_GROUPS.map((g) => (
            <Stack key={g.title} gap={6}>
              <Divider
                label={g.title.toUpperCase()}
                labelPosition="left"
                styles={{ label: { fontWeight: 600, fontSize: 10 } }}
              />
              <SimpleGrid cols={2} spacing={6} verticalSpacing={6}>
                {g.items.map((item) => (
                  <ColorInput
                    key={item.var}
                    size="xs"
                    format="hex"
                    label={item.label}
                    value={valueOf(item.var)}
                    onChange={(v) => setVar(item.var, v)}
                    swatches={SWATCHES}
                    swatchesPerRow={7}
                    styles={{ label: { fontSize: 11 } }}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          ))}

          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={resetAll}
          >
            Reset to palette defaults
          </Button>
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  )
}
