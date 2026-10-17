import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core'
import { emit, overlays } from 'basalt-ui/commands'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import { IconCheck } from '@tabler/icons-react'
import { z } from 'zod'
import { useNow } from '../../../lib/use-now'
import { useCreateSkinfoldLog } from '../../../lib/queries/skinfold-log'
import { SKINFOLD_SITES } from '../constants'
import { dayKey } from '../model'

const mm = z.number().min(1, 'At least 1 mm').max(100, 'At most 100 mm').optional()

const SkinfoldLogSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    abdominal: mm,
    suprailiac: mm,
  })
  .refine((v) => v.abdominal !== undefined || v.suprailiac !== undefined, {
    message: 'Enter at least one site',
    path: ['abdominal'],
  })

/** Body of the `body-comp:log-skinfold` overlay: one date, one reading per caliper site. */
export function SkinfoldLogForm() {
  const now = useNow()
  const createSkinfoldLog = useCreateSkinfoldLog()
  const form = useBasaltForm({
    initialValues: {
      date: dayKey(now),
      abdominal: '' as unknown as number,
      suprailiac: '' as unknown as number,
    },
    schema: SkinfoldLogSchema,
  })

  return (
    <form
      onSubmit={form.onSubmit((values) => {
        const readings = SKINFOLD_SITES.flatMap(({ key }) => {
          const value = values[key]
          return typeof value === 'number' ? [{ site: key, value_mm: value }] : []
        })
        createSkinfoldLog.mutate(
          { date: values.date, readings },
          {
            onSuccess: () => {
              emit(
                'body-comp:save-success',
                {
                  message: `${readings.length} reading${readings.length === 1 ? '' : 's'} on ${values.date}`,
                },
                { title: 'Skinfold logged', icon: <IconCheck size={18} />, autoClose: 2000 },
              )
              overlays.close()
            },
            onError: (err) =>
              emit(
                'body-comp:save-error',
                { message: err instanceof Error ? err.message : 'Unknown error' },
                { title: 'Could not save skinfold reading' },
              ),
          },
        )
      })}
    >
      <Stack gap="sm">
        <TextInput
          type="date"
          label="Date"
          key={fieldKey(form, 'date')}
          {...inputProps(form, 'date')}
        />
        {SKINFOLD_SITES.map((site) => (
          <NumberInput
            key={fieldKey(form, site.key)}
            label={site.label}
            description={site.description}
            min={1}
            max={100}
            step={0.1}
            decimalScale={1}
            suffix=" mm"
            inputMode="decimal"
            {...inputProps(form, site.key)}
          />
        ))}
        <Group justify="flex-end">
          <Button type="submit" loading={createSkinfoldLog.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
