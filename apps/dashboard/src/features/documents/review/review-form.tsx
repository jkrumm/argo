import { Alert, Autocomplete, Button, SimpleGrid, Stack, TextInput } from '@mantine/core'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { useState } from 'react'
import type { DecideBody, ReviewEntry } from '../../../lib/queries/paper'
import { buildDecision, manualDefaults, type ManualValues, type Suggestions } from './model'

type ReviewFormProps = {
  item: ReviewEntry
  busy: boolean
  suggestions: Suggestions
  onDecide: (body: DecideBody) => void
}

/** Decide by hand: split points or the values of one document, suggestions from the index. */
export function ReviewForm({ item, busy, suggestions, onDecide }: ReviewFormProps) {
  const [problem, setProblem] = useState<string | null>(null)
  const form = useBasaltForm<ManualValues>({ initialValues: manualDefaults(item) })

  return (
    <form
      onSubmit={form.onSubmit((values) => {
        const decision = buildDecision(values)
        if ('error' in decision) return setProblem(decision.error)
        setProblem(null)
        onDecide(decision.body)
      })}
    >
      <Stack gap="sm">
        <TextInput
          label="Split before pages"
          description="First pages of the documents after the first, e.g. 9, 10, 12"
          placeholder="9, 10, 12"
          inputMode="numeric"
          key={fieldKey(form, 'split')}
          {...inputProps(form, 'split')}
        />
        <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.regular]: 2 }} spacing="sm">
          <Autocomplete
            label="Kind"
            placeholder="invoice"
            data={suggestions.kinds}
            key={fieldKey(form, 'kind')}
            {...inputProps(form, 'kind')}
          />
          <Autocomplete
            label="Issuer"
            data={suggestions.issuers}
            key={fieldKey(form, 'issuer')}
            {...inputProps(form, 'issuer')}
          />
          <TextInput
            label="Date"
            type="date"
            key={fieldKey(form, 'date')}
            {...inputProps(form, 'date')}
          />
          <TextInput label="Title" key={fieldKey(form, 'title')} {...inputProps(form, 'title')} />
        </SimpleGrid>
        {problem && (
          <Alert color="red" title="Check the form">
            {problem}
          </Alert>
        )}
        <Button type="submit" loading={busy}>
          Decide
        </Button>
      </Stack>
    </form>
  )
}
