import { useState } from 'react'
import { ActionIcon, Box, Flex, Group, Stack, Text } from '@mantine/core'
import { IconArrowRight, IconBackspace } from '@tabler/icons-react'
import cls from './number-pad.module.css'

/**
 * The calculator keypad shared by the weight and reps popovers. Extracted so the two entry points
 * behave identically — same key layout, same replace-then-append semantics, same touch targets —
 * rather than drifting apart as two hand-maintained copies.
 */

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** Trims float noise (82.500000001 -> "82.5") without losing a real fractional value. */
export function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString()
}

export function parseBuffer(buffer: string): number {
  const n = Number(buffer)
  return Number.isFinite(n) ? n : 0
}

export interface NumberBuffer {
  buffer: string
  /** Seed the buffer, choosing whether the next digit replaces it or appends to it. */
  reset: (next: string, replaceNext: boolean) => void
  pressDigit: (key: string) => void
  step: (delta: number, min: number) => void
}

/**
 * Buffer mechanics for a keypad. `replaceNext` is what makes the pad feel like a calculator: after
 * seeding from the current value the first digit replaces the whole buffer, but every digit after
 * that appends.
 */
export function useNumberBuffer(): NumberBuffer {
  const [buffer, setBuffer] = useState('')
  const [replaceNext, setReplaceNext] = useState(true)

  return {
    buffer,
    reset: (next, replaceNextValue) => {
      setBuffer(next)
      setReplaceNext(replaceNextValue)
    },
    pressDigit: (key) => {
      if (key === '⌫') {
        setBuffer((prev) => prev.slice(0, -1))
        setReplaceNext(false)
        return
      }
      if (key === '.') {
        setBuffer((prev) => {
          if (replaceNext) return '0.'
          return prev.includes('.') ? prev : `${prev}.`
        })
        setReplaceNext(false)
        return
      }
      setBuffer((prev) => (replaceNext ? key : prev + key))
      setReplaceNext(false)
    },
    step: (delta, min) => {
      setBuffer((prev) => formatNumber(Math.max(min, parseBuffer(prev) + delta)))
      setReplaceNext(false)
    },
  }
}

export interface NumberPadProps {
  buffer: string
  /** Shown next to the value, e.g. 'kg'. Omitted for a bare count. */
  unit?: string
  /** Whether a decimal point is offered — reps are integers, weights are not. */
  decimal?: boolean
  stepBy: number
  onDigit: (key: string) => void
  onStep: (delta: number) => void
  onConfirm: () => void
}

export function NumberPad({
  buffer,
  unit,
  decimal = false,
  stepBy,
  onDigit,
  onStep,
  onConfirm,
}: NumberPadProps) {
  return (
    <Stack gap="sm">
      <Group justify="center" gap={4} align="baseline">
        <Text component="span" className={cls['valueText']}>
          {buffer || '0'}
        </Text>
        {unit !== undefined && (
          <Text component="span" size="sm" className={cls['unit']}>
            {unit}
          </Text>
        )}
      </Group>

      <Flex gap="sm">
        <Box className={cls['digitGrid']}>
          {DIGITS.map((key) => (
            <button
              key={key}
              type="button"
              className={cls['digitKey']}
              onClick={() => onDigit(key)}
              aria-label={key}
            >
              {key}
            </button>
          ))}
          {/* Integer pads keep the 3x4 grid but leave the decimal slot empty, so 0 and
              backspace stay under the same thumb position on both pads. */}
          {decimal ? (
            <button
              type="button"
              className={cls['digitKey']}
              onClick={() => onDigit('.')}
              aria-label="Decimal point"
            >
              .
            </button>
          ) : (
            <Box />
          )}
          <button
            type="button"
            className={cls['digitKey']}
            onClick={() => onDigit('0')}
            aria-label="0"
          >
            0
          </button>
          <button
            type="button"
            className={cls['digitKey']}
            onClick={() => onDigit('⌫')}
            aria-label="Backspace"
          >
            <IconBackspace size={16} />
          </button>
        </Box>

        <Stack gap={6} w={44}>
          <button
            type="button"
            className={cls['stepperBtn']}
            onClick={() => onStep(-stepBy)}
            aria-label={`Decrease ${stepBy}`}
          >
            −
          </button>
          <button
            type="button"
            className={cls['stepperBtn']}
            onClick={() => onStep(stepBy)}
            aria-label={`Increase ${stepBy}`}
          >
            +
          </button>
          <ActionIcon
            variant="filled"
            color="blue"
            size={40}
            onClick={onConfirm}
            aria-label="Confirm"
          >
            <IconArrowRight size={16} />
          </ActionIcon>
        </Stack>
      </Flex>
    </Stack>
  )
}
