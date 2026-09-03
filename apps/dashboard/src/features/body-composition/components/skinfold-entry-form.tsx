import { useState } from 'react'
import {
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  TextInput,
  Transition,
} from '@mantine/core'
import { emit } from 'basalt-ui/notifications'
import { IconCheck } from '@tabler/icons-react'
import { useCreateSkinfoldLog, type SkinfoldSite } from '../../../lib/queries/skinfold-log'
import { SKINFOLD_SITES } from '../constants'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

type SiteValues = Partial<Record<SkinfoldSite, number | ''>>

export function SkinfoldEntryForm() {
  const [date, setDate] = useState(today())
  const [values, setValues] = useState<SiteValues>({})
  const [justSaved, setJustSaved] = useState(false)
  const createSkinfoldLog = useCreateSkinfoldLog()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const readings = SKINFOLD_SITES.map((s) => ({ site: s.key, raw: values[s.key] }))
      .filter((r): r is { site: SkinfoldSite; raw: number } => typeof r.raw === 'number')
      .map((r) => ({ site: r.site, value_mm: r.raw }))
    if (readings.length === 0) return

    createSkinfoldLog.mutate(
      { date, readings },
      {
        onSuccess: () => {
          setJustSaved(true)
          emit(
            'body-comp:save-success',
            { message: `${readings.length} reading${readings.length === 1 ? '' : 's'} on ${date}` },
            { title: 'Skinfold logged', icon: <IconCheck size={18} />, autoClose: 2000 },
          )
          setValues({})
          setTimeout(() => setJustSaved(false), 1400)
        },
        onError: (err) => {
          emit(
            'body-comp:save-error',
            { message: err instanceof Error ? err.message : 'Unknown error' },
            { title: 'Could not save skinfold reading' },
          )
        },
      },
    )
  }

  return (
    <Paper py="xs" px="sm">
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Log Skinfold
          </Text>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              type="date"
              label="Date"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
              size="md"
              style={{ flex: 1, minWidth: 140 }}
            />
            {SKINFOLD_SITES.map((site) => (
              <NumberInput
                key={site.key}
                label={site.label}
                description={site.description}
                min={1}
                max={100}
                step={0.1}
                decimalScale={1}
                suffix=" mm"
                size="md"
                style={{ flex: 1, minWidth: 160 }}
                inputMode="decimal"
                value={values[site.key] ?? ''}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, [site.key]: typeof v === 'number' ? v : '' }))
                }
              />
            ))}
            <Button
              type="submit"
              size="md"
              loading={createSkinfoldLog.isPending}
              {...(justSaved ? { color: 'green' } : {})}
              leftSection={
                <Transition mounted={justSaved} transition="pop" duration={180}>
                  {(styles) => <IconCheck size={16} style={styles} />}
                </Transition>
              }
              styles={{
                root: { transition: 'background-color 180ms ease, transform 120ms ease' },
              }}
            >
              {justSaved ? 'Saved' : 'Save'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  )
}
