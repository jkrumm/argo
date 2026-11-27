import { Alert, Button, NumberInput, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { overlays } from 'basalt-ui/commands'
import { FormRow } from 'basalt-ui/controls'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import { api } from '../../../lib/eden'
import { paperError } from '../../../lib/queries/paper'
import { PrintSchema, printBody, printSummary } from './print'

/** The print dialog of one document (overlay `documents:print`). Nothing prints before "Print". */
export function PrintForm({ id, title }: { id: string; title: string }) {
  const form = useBasaltForm({
    initialValues: { sides: 'auto' as 'auto' | 'simplex', pages: '', copies: 1 },
    schema: PrintSchema,
  })
  const print = useMutation({
    mutationFn: async (values: typeof form.values) =>
      unwrap(await api.paper.docs({ id }).print.post(printBody(values))),
  })

  if (print.data) {
    return (
      <Stack gap="sm">
        <Alert color="green" variant="light" title={print.data.message ?? 'Sent to the printer'}>
          {printSummary(print.data)}
        </Alert>
        {print.data.warnings?.map((warning) => (
          <Alert key={warning} color="yellow" variant="light">
            {warning}
          </Alert>
        ))}
        <Button variant="default" onClick={() => overlays.close()}>
          Close
        </Button>
      </Stack>
    )
  }

  return (
    <form onSubmit={form.onSubmit((values) => print.mutate(values))}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed" lineClamp={2}>
          {title}
        </Text>
        <FormRow label="Sides">
          <SegmentedControl
            data={[
              { value: 'auto', label: 'Two-sided' },
              { value: 'simplex', label: 'One-sided' },
            ]}
            key={fieldKey(form, 'sides')}
            {...inputProps(form, 'sides')}
          />
        </FormRow>
        <TextInput
          label="Pages"
          placeholder="All, or 1-3,5"
          key={fieldKey(form, 'pages')}
          {...inputProps(form, 'pages')}
        />
        <NumberInput
          label="Copies"
          min={1}
          max={99}
          allowDecimal={false}
          key={fieldKey(form, 'copies')}
          {...inputProps(form, 'copies')}
        />
        {print.error ? (
          <Alert color="red" variant="light">
            {paperError(print.error)}
          </Alert>
        ) : null}
        <Button type="submit" loading={print.isPending}>
          Print
        </Button>
      </Stack>
    </form>
  )
}
