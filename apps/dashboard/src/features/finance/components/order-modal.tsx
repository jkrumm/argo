import { Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { reportWriteError, useOrderWrites } from '../api/mutations'
import { dayDe, moneyDe, priceDe } from '../lib/depot-number'
import { dayToSeconds } from '../lib/depot-chart'
import { spreadText, suggestedLimit } from '../lib/depot-live'
import type { AddOrderRequest, MarketQuote, OrderType, TradeSide } from '../api/types'

const SIDES: { value: TradeSide; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
]
const TYPES: { value: OrderType; label: string }[] = [
  { value: 'limit', label: 'Limit' },
  { value: 'stop', label: 'Stop' },
  { value: 'market', label: 'Market' },
]

const Schema = z
  .object({
    isin: z.string().min(1, 'Choose the instrument'),
    side: z.enum(['buy', 'sell']),
    type: z.enum(['limit', 'stop', 'market']),
    quantity: z.number({ error: 'Enter a quantity' }).positive('Enter a quantity'),
    price: z.union([z.number().positive('Enter a price'), z.literal('')]),
    valid_until: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a date'),
    note: z.string().max(200),
  })
  .refine((v) => v.type === 'market' || v.price !== '', {
    path: ['price'],
    message: 'A limit or stop order needs its price',
  })

type Values = z.input<typeof Schema>

/**
 * Adds one hand-kept order to the chart. ING has no interface for orders, so the list is typed in
 * here and closed here; nothing on this page places, changes or deletes an order at the bank. ING
 * trades in euros, so the price is typed in euros.
 */
export function OrderModal({
  choices,
  choose,
  rate,
  quotes,
  onClose,
}: {
  /** The instruments the order can be for; the first is preselected. */
  choices: readonly { isin: string; name: string }[]
  /** Show the choice: an index entry's order goes on an ETF that tracks it. */
  choose: boolean
  /** The latest ECB rate, for an instrument charted in dollars: the price is also shown in dollars. */
  rate: { usdPerEur: number; day: string } | null
  /** ING Direkthandel's quote of each choice, by ISIN. */
  quotes: ReadonlyMap<string, MarketQuote>
  onClose: () => void
}) {
  const orders = useOrderWrites()
  const form = useBasaltForm<Values>({
    // The price in dollars and the stop or limit label follow what is typed.
    mode: 'controlled',
    initialValues: {
      isin: choices[0]?.isin ?? '',
      side: 'buy',
      type: 'limit',
      quantity: '' as never,
      price: '',
      valid_until: '',
      note: '',
    },
    schema: Schema,
  })

  async function submit(values: Values) {
    const parsed = Schema.parse(values)
    const request: AddOrderRequest = {
      isin: parsed.isin,
      side: parsed.side,
      type: parsed.type,
      quantity: parsed.quantity,
      ...(parsed.type === 'limit' && parsed.price !== '' && { limit_price: parsed.price }),
      ...(parsed.type === 'stop' && parsed.price !== '' && { stop_price: parsed.price }),
      ...(parsed.valid_until !== '' && { valid_until: parsed.valid_until }),
      ...(parsed.note !== '' && { note: parsed.note }),
    }
    try {
      await orders.add(request)
      onClose()
    } catch (error) {
      reportWriteError(error)
    }
  }

  const typed = form.getValues()
  const quote = quotes.get(typed.isin)
  // A limit starts at the price it would trade at now: the ask to buy, the bid to sell. It is set once per instrument,
  // side and type, never under the owner's eyes as the quote moves, and never over a price he typed.
  const prefilled = useRef<number | ''>('')
  const answered = quote !== undefined
  useEffect(
    () => {
      const current = form.getValues().price
      if (current !== '' && current !== prefilled.current) return
      const next =
        typed.type === 'limit' ? (suggestedLimit(typed.side, quotes.get(typed.isin)) ?? '') : ''
      prefilled.current = next
      form.setFieldValue('price', next)
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [typed.isin, typed.side, typed.type, answered],
  )
  const spread = spreadText(quote)
  const dollars =
    rate !== null && typed.type !== 'market' && typeof typed.price === 'number'
      ? typed.price * rate.usdPerEur
      : null
  const priceNote =
    rate === null
      ? undefined
      : `${dollars === null ? 'ING trades in euros' : `≈ ${moneyDe(dollars, 'USD')}`} at ${priceDe(rate.usdPerEur)} $ per € (${dayDe(dayToSeconds(rate.day))})`

  return (
    <Modal opened onClose={onClose} title="Add an order" centered>
      <form onSubmit={form.onSubmit((values) => void submit(values))}>
        <Stack gap="sm">
          {choose && (
            <Select
              key={fieldKey(form, 'isin')}
              {...inputProps(form, 'isin')}
              label="ETF"
              data={choices.map((c) => ({ value: c.isin, label: c.name }))}
              allowDeselect={false}
            />
          )}
          <Group grow align="flex-start">
            <Select
              key={fieldKey(form, 'side')}
              {...inputProps(form, 'side')}
              label="Side"
              data={SIDES}
              allowDeselect={false}
            />
            <Select
              key={fieldKey(form, 'type')}
              {...inputProps(form, 'type')}
              label="Type"
              data={TYPES}
              allowDeselect={false}
            />
          </Group>
          <Group grow align="flex-start">
            <NumberInput
              key={fieldKey(form, 'quantity')}
              {...inputProps(form, 'quantity')}
              label="Quantity"
              decimalSeparator=","
              allowedDecimalSeparators={[',', '.']}
              min={0}
              decimalScale={4}
              hideControls
            />
            <NumberInput
              key={fieldKey(form, 'price')}
              {...inputProps(form, 'price')}
              label={typed.type === 'stop' ? 'Stop price (€)' : 'Limit price (€)'}
              disabled={typed.type === 'market'}
              decimalSeparator=","
              allowedDecimalSeparators={[',', '.']}
              min={0}
              decimalScale={4}
              hideControls
            />
          </Group>
          {spread !== null && (
            <Text size="xs" c="dimmed" data-shot="order-spread">
              {`ING Direkthandel: ${spread}${quote?.session === 'closed' ? ' · Börse geschlossen' : ''}`}
            </Text>
          )}
          {priceNote !== undefined && (
            <Text size="xs" c="dimmed" data-shot="order-usd">
              {priceNote}
            </Text>
          )}
          <TextInput
            key={fieldKey(form, 'valid_until')}
            {...inputProps(form, 'valid_until')}
            label="Valid until"
            type="date"
          />
          <TextInput
            key={fieldKey(form, 'note')}
            {...inputProps(form, 'note')}
            label="Note"
            maxLength={200}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Add order
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
