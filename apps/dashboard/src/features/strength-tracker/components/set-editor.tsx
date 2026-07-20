import { useRef, useState } from 'react'
import { ActionIcon, Box, Button, Flex, NumberInput } from '@mantine/core'
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react'
import { VX, alpha } from 'basalt-ui/tokens'
import type { LoadingMode } from '../../../lib/plate-math'
import type { SetType } from '../constants'
import { WeightPopover } from './weight-popover'
import cls from './set-editor.module.css'

export type SetEntry = {
  set_type: SetType
  weight_kg: number
  reps: number
}

const TYPE_CYCLE: SetType[] = ['work', 'warmup', 'drop', 'amrap']
const TYPE_ABBREV: Record<SetType, string> = { warmup: 'W', work: '', drop: 'D', amrap: 'A' }
const TYPE_COLOR: Record<SetType, string> = {
  warmup: alpha(VX.neutral, 0.5),
  work: 'inherit',
  drop: alpha(VX.neutral, 0.5),
  amrap: 'inherit',
}

export interface SetEditorProps {
  sets: SetEntry[]
  onChange?: (sets: SetEntry[]) => void
  previousSets?: SetEntry[]
  readOnly?: boolean
  /**
   * Guided check-off flow: only the first unchecked set is editable + checkable,
   * earlier sets lock as done, later sets dim until reached. Drives the Save gate
   * and the auto rest timer in the parent form.
   */
  checklist?: boolean
  /** Number of sets checked off, counted from the top (only with `checklist`). */
  completedCount?: number
  onCompletedChange?: (count: number) => void
  /**
   * How the selected exercise's weight is physically assembled. Drives the weight
   * popover's plate calculator; `free` hides it and leaves just the keypad.
   */
  loadingMode?: LoadingMode
  /** Which bar the exercise uses, when `loadingMode` is 'barbell'. */
  barId?: string
  /** Persists a bar change back to the exercise's entry in the gym profile. */
  onBarChange?: (barId: string) => void
  /** Opens the gym-equipment settings modal (owned by the parent form). */
  onOpenSettings?: () => void
}

/**
 * Inline keyboard-driven set editor. Ported from the AntD version in
 * `argo-old/.../set-editor.tsx`. Dense grid of `NumberInput`s
 * (`variant="unstyled"`, `hideControls`) for weight/reps, paired with
 * custom ± stepper buttons and a label that cycles set type on click.
 *
 * Features:
 * - Label column cycles set type on click (work → warmup → drop → amrap).
 * - Work sets are numbered (1, 2, 3...); other types show their letter (W/D/A).
 * - ± steppers on weight (0.5 kg) and reps (1) — visible on row hover on
 *   desktop, pinned visible on touch (coarse-pointer devices have no hover).
 * - Previous-session column when `previousSets` is provided.
 * - Weight is not a text field: the cell is a button that opens `WeightPopover`
 *   (keypad + plate calculator). Typing a digit on it opens straight into the
 *   keypad with that digit; Tab still jumps to the row's reps input.
 * - `readOnly` mode renders a compact text view without edit affordances.
 */
export function SetEditor({
  sets,
  onChange,
  previousSets,
  readOnly = false,
  checklist = false,
  completedCount = 0,
  onCompletedChange,
  loadingMode = 'free',
  barId = '',
  onBarChange,
  onOpenSettings,
}: SetEditorProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  // Index of the row whose weight popover is open — a single slot, so only one
  // can ever be open at a time.
  const [openRow, setOpenRow] = useState<number | null>(null)
  // The digit that opened the popover, when it was opened by typing rather than
  // tapping. Handed to the popover so the keystroke isn't swallowed.
  const [pendingDigit, setPendingDigit] = useState<string | null>(null)
  const repsRefs = useRef<(HTMLInputElement | null)[]>([])

  function openWeight(i: number, digit: string | null) {
    setPendingDigit(digit)
    setOpenRow(i)
  }

  function emit(next: SetEntry[]) {
    onChange?.(next)
  }

  function addSet() {
    const last = sets[sets.length - 1] ?? {
      set_type: 'work' as SetType,
      weight_kg: 60,
      reps: 5,
    }
    emit([...sets, { set_type: last.set_type, weight_kg: last.weight_kg, reps: last.reps }])
  }

  function updateSet<K extends keyof SetEntry>(i: number, field: K, value: SetEntry[K]) {
    emit(sets.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
  }

  function removeSet(i: number) {
    // Row indices shift on removal, so a popover keyed to an index would end up
    // anchored to the wrong set. Close it rather than try to re-map.
    setOpenRow(null)
    emit(sets.filter((_, idx) => idx !== i))
  }

  function cycleType(i: number) {
    const current = sets[i]?.set_type ?? 'work'
    const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(current) + 1) % TYPE_CYCLE.length]!
    updateSet(i, 'set_type', next)
  }

  const hasPrevious = previousSets !== undefined && previousSets.length > 0

  // Numbered labels: work sets get sequential numbers, others get a letter.
  let workNum = 0
  const labels = sets.map((s) => {
    if (s.set_type === 'work') {
      workNum++
      return String(workNum)
    }
    return TYPE_ABBREV[s.set_type]
  })

  return (
    <Box>
      {/* Header row */}
      <Flex align="center" className={`${cls.header} ${cls.headCell}`}>
        <Box component="span" w={30} pl={2}>
          Set
        </Box>
        {hasPrevious && (
          <Box component="span" w={72}>
            Previous
          </Box>
        )}
        <Box component="span" className={cls.cell} ta="center">
          KG
        </Box>
        <Box component="span" className={cls.cell} ta="center">
          Reps
        </Box>
        {!readOnly && <Box component="span" w={checklist ? 52 : 26} />}
      </Flex>

      {/* Set rows */}
      {sets.map((s, i) => {
        const isHovered = !readOnly && hoveredRow === i
        const prev = previousSets?.[i]
        const isChecked = checklist && i < completedCount
        const isActive = checklist && i === completedCount
        const editable = !readOnly
        const dimmed = checklist && !isActive

        return (
          <Flex
            key={i}
            align="center"
            className={cls.row}
            data-checklist={checklist}
            data-active={isActive}
            data-hovered={isHovered}
            data-dimmed={dimmed}
            onMouseEnter={() => !readOnly && setHoveredRow(i)}
            onMouseLeave={() => !readOnly && setHoveredRow(null)}
          >
            {/* Set type label (click to cycle) */}
            <button
              type="button"
              className={cls.typeButton}
              onClick={() => editable && cycleType(i)}
              disabled={!editable}
              style={{ color: TYPE_COLOR[s.set_type] }}
              title={editable ? 'Click to change set type' : undefined}
            >
              {labels[i]}
            </button>

            {/* Previous reference */}
            {hasPrevious && (
              <Box
                component="span"
                w={72}
                fz={VX.text.micro}
                style={{ color: alpha(VX.neutral, 0.4), whiteSpace: 'nowrap' }}
              >
                {prev !== undefined ? `${prev.weight_kg} × ${prev.reps}` : '—'}
              </Box>
            )}

            {/* Weight column */}
            {readOnly ? (
              <Flex align="center" className={cls.cell}>
                <Box component="span" className={cls.readOnlyValue}>
                  {s.weight_kg}
                </Box>
              </Flex>
            ) : (
              <WeightPopover
                value={s.weight_kg}
                onChange={(v) => updateSet(i, 'weight_kg', v)}
                loadingMode={loadingMode}
                barId={barId}
                onBarChange={onBarChange}
                opened={openRow === i}
                seedDigit={openRow === i ? pendingDigit : null}
                onClose={() => setOpenRow(null)}
                onCommit={() => {
                  setOpenRow(null)
                  repsRefs.current[i]?.focus()
                  repsRefs.current[i]?.select()
                }}
                onOpenSettings={onOpenSettings}
              >
                <Flex align="center" className={cls.cell}>
                  <button
                    type="button"
                    className={cls.stepper}
                    onClick={() => updateSet(i, 'weight_kg', Math.max(0, s.weight_kg - 0.5))}
                    aria-label="Decrement weight"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className={cls.weightTrigger}
                    onClick={() => (openRow === i ? setOpenRow(null) : openWeight(i, null))}
                    onKeyDown={(e) => {
                      // Tab still hands off to reps, so the row stays keyboard-fast.
                      if (e.key === 'Tab' && !e.shiftKey) {
                        e.preventDefault()
                        repsRefs.current[i]?.focus()
                        repsRefs.current[i]?.select()
                        return
                      }
                      // Typing a number goes straight into the keypad rather than
                      // being dropped on a button that can't accept text.
                      if (/^[0-9]$/.test(e.key)) {
                        e.preventDefault()
                        openWeight(i, e.key)
                      }
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={openRow === i}
                    aria-label={`Weight ${s.weight_kg} kg — open keypad and plate calculator`}
                  >
                    {s.weight_kg}
                  </button>
                  <button
                    type="button"
                    className={cls.stepper}
                    onClick={() => updateSet(i, 'weight_kg', s.weight_kg + 0.5)}
                    aria-label="Increment weight"
                  >
                    +
                  </button>
                </Flex>
              </WeightPopover>
            )}

            {/* Reps column */}
            <Flex align="center" className={cls.cell}>
              {editable && (
                <button
                  type="button"
                  className={cls.stepper}
                  onClick={() => updateSet(i, 'reps', Math.max(1, s.reps - 1))}
                  aria-label="Decrement reps"
                >
                  −
                </button>
              )}
              {readOnly ? (
                <Box component="span" className={cls.readOnlyValue}>
                  {s.reps}
                </Box>
              ) : (
                <NumberInput
                  ref={(el) => {
                    repsRefs.current[i] = el
                  }}
                  classNames={{ input: cls.input }}
                  variant="unstyled"
                  hideControls
                  clampBehavior="none"
                  inputMode="numeric"
                  value={s.reps}
                  disabled={!editable}
                  onChange={(value) => {
                    const v = typeof value === 'number' ? value : Number(value)
                    if (!Number.isNaN(v) && v >= 1) updateSet(i, 'reps', v)
                  }}
                  step={1}
                  min={1}
                  max={100}
                  className={cls.cell}
                />
              )}
              {editable && (
                <button
                  type="button"
                  className={cls.stepper}
                  onClick={() => updateSet(i, 'reps', Math.min(100, s.reps + 1))}
                  aria-label="Increment reps"
                >
                  +
                </button>
              )}
            </Flex>

            {/* Check + remove */}
            {!readOnly && (
              <Flex
                w={checklist ? 52 : 26}
                justify="flex-end"
                align="center"
                gap={2}
                className={cls.actions}
              >
                {checklist && (
                  <ActionIcon
                    size="sm"
                    variant={isChecked ? 'filled' : isActive ? 'outline' : 'subtle'}
                    color={isActive || isChecked ? 'blue' : 'gray'}
                    disabled={!(isActive || i === completedCount - 1)}
                    onClick={() =>
                      onCompletedChange?.(isActive ? completedCount + 1 : completedCount - 1)
                    }
                    aria-label={isChecked ? 'Uncheck set' : 'Check set'}
                  >
                    <IconCheck size={12} />
                  </ActionIcon>
                )}
                {sets.length > 1 && (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    disabled={isChecked}
                    onClick={() => removeSet(i)}
                    aria-label="Remove set"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                )}
              </Flex>
            )}
          </Flex>
        )
      })}

      {/* Add set button */}
      {!readOnly && (
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          fullWidth
          mt={6}
          leftSection={<IconPlus size={12} />}
          onClick={addSet}
        >
          Add Set
        </Button>
      )}
    </Box>
  )
}
