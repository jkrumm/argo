import { useRef, useState } from 'react'
import { ActionIcon, Button, NumberInput } from '@mantine/core'
import { IconCheck, IconPlus, IconX } from '@tabler/icons-react'
import { VX, alpha } from 'basalt-ui/tokens'
import type { SetType } from '../constants'

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
 * - Tab on weight input focuses reps input of the same row.
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
}: SetEditorProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const repsRefs = useRef<(HTMLInputElement | null)[]>([])

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

  const stepperStyle: React.CSSProperties = {
    width: 18,
    height: 18,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    padding: 0,
    flexShrink: 0,
    transition: 'opacity 0.15s',
    borderRadius: 3,
    lineHeight: 1,
  }

  // Targets NumberInput's `input` stylesName — variant="unstyled" already strips the
  // Mantine chrome (border/background/outline), this layers the bespoke underline back on.
  const inputBase: React.CSSProperties = {
    textAlign: 'center',
    width: '100%',
    fontSize: 16,
    padding: '4px 4px',
    borderBottom: '1px solid transparent',
    transition: 'border-color 0.15s',
  }

  const inputHover: React.CSSProperties = {
    borderBottom: `1px solid ${alpha(VX.neutral, 0.3)}`,
  }

  return (
    <div>
      <style>{`
        .st-set-input:focus { border-bottom-color: ${alpha(VX.neutral, 0.5)} !important; }
        .st-stepper:hover:not(:disabled) { background: ${alpha(VX.neutral, 0.12)} !important; opacity: 0.8 !important; }
        @media (pointer: coarse) {
          .st-stepper { opacity: 0.55 !important; width: 26px !important; height: 26px !important; }
        }
      `}</style>

      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '0 0 4px',
          borderBottom: `1px solid ${alpha(VX.neutral, 0.12)}`,
          marginBottom: 2,
        }}
      >
        <span style={{ width: 30, fontSize: 11, color: alpha(VX.neutral, 0.5), paddingLeft: 2 }}>
          Set
        </span>
        {hasPrevious && (
          <span style={{ width: 72, fontSize: 11, color: alpha(VX.neutral, 0.5) }}>Previous</span>
        )}
        <span style={{ flex: 1, fontSize: 11, color: alpha(VX.neutral, 0.5), textAlign: 'center' }}>
          KG
        </span>
        <span style={{ flex: 1, fontSize: 11, color: alpha(VX.neutral, 0.5), textAlign: 'center' }}>
          Reps
        </span>
        {!readOnly && <span style={{ width: checklist ? 52 : 26 }} />}
      </div>

      {/* Set rows */}
      {sets.map((s, i) => {
        const isHovered = !readOnly && hoveredRow === i
        const prev = previousSets?.[i]
        const isChecked = checklist && i < completedCount
        const isActive = checklist && i === completedCount
        const editable = !readOnly
        const dimmed = checklist && !isActive

        return (
          <div
            key={i}
            onMouseEnter={() => !readOnly && setHoveredRow(i)}
            onMouseLeave={() => !readOnly && setHoveredRow(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              padding: checklist ? '7px var(--mantine-spacing-md)' : '7px 0',
              marginInline: checklist ? 'calc(var(--mantine-spacing-md) * -1)' : undefined,
              borderBottom: `1px solid ${alpha(VX.neutral, 0.06)}`,
              transition: 'all 0.15s',
              borderRadius: checklist ? 0 : 3,
              opacity: dimmed ? 0.5 : 1,
              background: isActive
                ? alpha(VX.goodSolid, 0.08)
                : isHovered
                  ? alpha(VX.neutral, 0.06)
                  : 'transparent',
            }}
          >
            {/* Set type label (click to cycle) */}
            <button
              type="button"
              onClick={() => editable && cycleType(i)}
              disabled={!editable}
              style={{
                width: 30,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                border: 'none',
                background: 'transparent',
                cursor: editable ? 'pointer' : 'default',
                color: TYPE_COLOR[s.set_type],
                padding: '0 0 0 2px',
                textAlign: 'left',
              }}
              title={editable ? 'Click to change set type' : undefined}
            >
              {labels[i]}
            </button>

            {/* Previous reference */}
            {hasPrevious && (
              <span
                style={{
                  width: 72,
                  fontSize: 11,
                  color: alpha(VX.neutral, 0.4),
                  whiteSpace: 'nowrap',
                }}
              >
                {prev !== undefined ? `${prev.weight_kg} × ${prev.reps}` : '—'}
              </span>
            )}

            {/* Weight column */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              {editable && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'weight_kg', Math.max(0, s.weight_kg - 0.5))}
                  style={{ ...stepperStyle, opacity: isHovered ? 0.5 : 0 }}
                  aria-label="Decrement weight"
                >
                  −
                </button>
              )}
              {readOnly ? (
                <span style={{ flex: 1, fontSize: 16, textAlign: 'center' }}>{s.weight_kg}</span>
              ) : (
                <NumberInput
                  classNames={{ input: 'st-set-input' }}
                  variant="unstyled"
                  hideControls
                  clampBehavior="none"
                  inputMode="decimal"
                  value={s.weight_kg}
                  disabled={!editable}
                  onChange={(value) => {
                    const v = typeof value === 'number' ? value : Number(value)
                    if (!Number.isNaN(v) && v >= 0) updateSet(i, 'weight_kg', v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault()
                      repsRefs.current[i]?.focus()
                      repsRefs.current[i]?.select()
                    }
                  }}
                  step={0.5}
                  min={0}
                  style={{ flex: 1, minWidth: 0 }}
                  styles={{ input: { ...inputBase, ...(isHovered ? inputHover : {}) } }}
                />
              )}
              {editable && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'weight_kg', s.weight_kg + 0.5)}
                  style={{ ...stepperStyle, opacity: isHovered ? 0.5 : 0 }}
                  aria-label="Increment weight"
                >
                  +
                </button>
              )}
            </div>

            {/* Reps column */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              {editable && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'reps', Math.max(1, s.reps - 1))}
                  style={{ ...stepperStyle, opacity: isHovered ? 0.5 : 0 }}
                  aria-label="Decrement reps"
                >
                  −
                </button>
              )}
              {readOnly ? (
                <span style={{ flex: 1, fontSize: 16, textAlign: 'center' }}>{s.reps}</span>
              ) : (
                <NumberInput
                  ref={(el) => {
                    repsRefs.current[i] = el
                  }}
                  classNames={{ input: 'st-set-input' }}
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
                  style={{ flex: 1, minWidth: 0 }}
                  styles={{ input: { ...inputBase, ...(isHovered ? inputHover : {}) } }}
                />
              )}
              {editable && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'reps', Math.min(100, s.reps + 1))}
                  style={{ ...stepperStyle, opacity: isHovered ? 0.5 : 0 }}
                  aria-label="Increment reps"
                >
                  +
                </button>
              )}
            </div>

            {/* Check + remove */}
            {!readOnly && (
              <div
                style={{
                  width: checklist ? 52 : 26,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 2,
                  opacity: checklist || isHovered ? 1 : 0.25,
                  transition: 'opacity 0.15s',
                }}
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
              </div>
            )}
          </div>
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
    </div>
  )
}
