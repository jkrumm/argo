import { Button, Group, NumberInput, Stack, TextInput } from '@mantine/core'
import { emit, overlays } from 'basalt-ui/commands'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import { IconCheck } from '@tabler/icons-react'
import { z } from 'zod'
import { useNow } from '../../../lib/use-now'
import { useCreateWeightLog } from '../../../lib/queries/weight-log'
import { dayKey } from '../model'

const WeightLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  weight_kg: z
    .number({ error: 'Enter a weight in kg' })
    .min(30, 'At least 30 kg')
    .max(300, 'At most 300 kg'),
})

/** Body of the `body-comp:log-weight` overlay: date defaults to today, weight to the last value. */
export function WeightLogForm({ lastWeight }: { lastWeight: number | null }) {
  const now = useNow()
  const createWeightLog = useCreateWeightLog()
  const form = useBasaltForm({
    initialValues: { date: dayKey(now), weight_kg: lastWeight ?? ('' as unknown as number) },
    schema: WeightLogSchema,
  })

  return (
    <form
      onSubmit={form.onSubmit(({ date, weight_kg }) =>
        createWeightLog.mutate(
          { date, weight_kg },
          {
            onSuccess: () => {
              emit(
                'body-comp:save-success',
                { message: `${weight_kg.toFixed(1)} kg on ${date}` },
                { title: 'Weight logged', icon: <IconCheck size={18} />, autoClose: 2000 },
              )
              overlays.close()
            },
            onError: (err) =>
              emit(
                'body-comp:save-error',
                { message: err instanceof Error ? err.message : 'Unknown error' },
                { title: 'Could not save weight' },
              ),
          },
        ),
      )}
    >
      <Stack gap="sm">
        <TextInput
          type="date"
          label="Date"
          key={fieldKey(form, 'date')}
          {...inputProps(form, 'date')}
        />
        <NumberInput
          label="Weight (kg)"
          min={30}
          max={300}
          step={0.1}
          decimalScale={1}
          inputMode="decimal"
          data-autofocus
          key={fieldKey(form, 'weight_kg')}
          {...inputProps(form, 'weight_kg')}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={createWeightLog.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
