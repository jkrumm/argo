import { useState } from 'react'
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  NumberInput,
  Radio,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { canRemoveProfile, loadingFor, type Bar } from '../../../lib/gym-profile'
import { useGyms } from '../../../lib/queries/gym'
import type { LoadingMode, PlateStock } from '../../../lib/plate-math'

export interface GymSettingsModalProps {
  opened: boolean
  onClose: () => void
  /** The exercise catalog, so each lift's loading can be configured per gym. */
  exercises: ReadonlyArray<{ value: string; label: string }>
}

const MODE_OPTIONS: { label: string; value: LoadingMode }[] = [
  { label: 'Barbell', value: 'barbell' },
  { label: 'Single', value: 'single' },
  { label: 'None', value: 'free' },
]

export function GymSettingsModal({ opened, onClose, exercises }: GymSettingsModalProps) {
  const gyms = useGyms()

  return (
    <Modal opened={opened} onClose={onClose} title="Gym Equipment" size="lg">
      {/* Remount on profile switch so draft rows re-seed from the newly active profile. */}
      <GymSettingsForm key={gyms.active.id} gyms={gyms} exercises={exercises} />
    </Modal>
  )
}

type PlateRow = { key: string; weight_kg: number; count: number }
type BarRow = { id: string; name: string; weight_kg: number }

function toNumber(value: string | number): number {
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Denomination/count validation: positive values, no duplicate denominations. */
function plateRowErrors(rows: PlateRow[]): Map<string, string> {
  const errors = new Map<string, string>()
  const seenAt = new Map<number, string>()

  for (const row of rows) {
    if (row.weight_kg <= 0 || row.count <= 0) {
      errors.set(row.key, 'Must be greater than 0')
      continue
    }
    const dupKey = seenAt.get(row.weight_kg)
    if (dupKey !== undefined) {
      errors.set(row.key, 'Duplicate denomination')
      errors.set(dupKey, 'Duplicate denomination')
    } else {
      seenAt.set(row.weight_kg, row.key)
    }
  }

  return errors
}

function barRowErrors(rows: BarRow[]): Map<string, string> {
  const errors = new Map<string, string>()
  for (const row of rows) {
    if (row.name.trim().length === 0) errors.set(row.id, 'Name is required')
    else if (row.weight_kg <= 0) errors.set(row.id, 'Must be greater than 0')
  }
  return errors
}

function GymSettingsForm({
  gyms,
  exercises,
}: {
  gyms: ReturnType<typeof useGyms>
  exercises: ReadonlyArray<{ value: string; label: string }>
}) {
  const {
    profiles,
    active,
    setActive,
    upsertProfile,
    removeProfile,
    addProfile,
    setExerciseLoading,
  } = gyms

  const [plateRows, setPlateRows] = useState<PlateRow[]>(() =>
    [...active.plates]
      .toSorted((a, b) => b.weight_kg - a.weight_kg)
      .map((plate) => ({
        key: crypto.randomUUID(),
        weight_kg: plate.weight_kg,
        count: plate.count,
      })),
  )
  const [barRows, setBarRows] = useState<BarRow[]>(() =>
    active.bars.map((bar) => ({ id: bar.id, name: bar.name, weight_kg: bar.weight_kg })),
  )
  const [defaultBarId, setDefaultBarId] = useState(active.defaultBarId)

  const [addingProfile, setAddingProfile] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [renamingProfile, setRenamingProfile] = useState(false)
  const [nameDraft, setNameDraft] = useState(active.name)

  const plateErrors = plateRowErrors(plateRows)
  const barErrors = barRowErrors(barRows)

  function persistPlates(rows: PlateRow[]) {
    if (plateRowErrors(rows).size > 0) return
    const plates: PlateStock = rows.map(({ weight_kg, count }) => ({ weight_kg, count }))
    upsertProfile({ ...active, plates })
  }

  function updatePlateRow(key: string, patch: Partial<Pick<PlateRow, 'weight_kg' | 'count'>>) {
    const next = plateRows.map((row) => (row.key === key ? { ...row, ...patch } : row))
    setPlateRows(next)
    persistPlates(next)
  }

  function addPlateRow() {
    setPlateRows([...plateRows, { key: crypto.randomUUID(), weight_kg: 0, count: 0 }])
  }

  function removePlateRow(key: string) {
    const next = plateRows.filter((row) => row.key !== key)
    setPlateRows(next)
    persistPlates(next)
  }

  function persistBars(rows: BarRow[], nextDefaultBarId: string) {
    if (barRowErrors(rows).size > 0) return
    const bars: Bar[] = rows.map(({ id, name, weight_kg }) => ({ id, name, weight_kg }))
    upsertProfile({ ...active, bars, defaultBarId: nextDefaultBarId })
  }

  function updateBarRow(id: string, patch: Partial<Pick<BarRow, 'name' | 'weight_kg'>>) {
    const next = barRows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    setBarRows(next)
    persistBars(next, defaultBarId)
  }

  function addBarRow() {
    setBarRows([...barRows, { id: crypto.randomUUID(), name: '', weight_kg: 0 }])
  }

  function removeBarRow(id: string) {
    if (barRows.length <= 1) return
    const next = barRows.filter((row) => row.id !== id)
    const nextDefault = defaultBarId === id ? (next[0]?.id ?? defaultBarId) : defaultBarId
    setBarRows(next)
    setDefaultBarId(nextDefault)
    persistBars(next, nextDefault)
  }

  function setDefaultBar(id: string) {
    setDefaultBarId(id)
    persistBars(barRows, id)
  }

  function handleAddProfile() {
    const name = newProfileName.trim()
    if (name.length === 0) return
    const created = addProfile(name)
    setActive(created.id)
    setNewProfileName('')
    setAddingProfile(false)
  }

  function handleRenameProfile() {
    const name = nameDraft.trim()
    if (name.length === 0) return
    upsertProfile({ ...active, name })
    setRenamingProfile(false)
  }

  function handleDeleteProfile() {
    if (!canRemoveProfile(profiles)) return
    modals.openConfirmModal({
      title: 'Delete gym profile',
      children: (
        <Text size="sm">
          Delete &quot;{active.name}&quot;? Its bars and plate rack are removed. This cannot be
          undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => removeProfile(active.id),
    })
  }

  const deleteProfileTitle = canRemoveProfile(profiles)
    ? 'Delete this profile'
    : "Can't delete the last profile"

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Profile
        </Text>
        <Group gap="sm" wrap="nowrap" align="flex-end">
          <Select
            label="Active gym"
            data={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            value={active.id}
            onChange={(value) => value !== null && setActive(value)}
            allowDeselect={false}
            flex={1}
          />
          <Tooltip label={deleteProfileTitle}>
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              disabled={!canRemoveProfile(profiles)}
              onClick={handleDeleteProfile}
              aria-label={deleteProfileTitle}
              title={deleteProfileTitle}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {addingProfile ? (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              placeholder="Gym name"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.currentTarget.value)}
              flex={1}
            />
            <Button
              size="sm"
              disabled={newProfileName.trim().length === 0}
              onClick={handleAddProfile}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setAddingProfile(false)
                setNewProfileName('')
              }}
            >
              Cancel
            </Button>
          </Group>
        ) : renamingProfile ? (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              placeholder="Gym name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.currentTarget.value)}
              flex={1}
            />
            <Button
              size="sm"
              disabled={nameDraft.trim().length === 0}
              onClick={handleRenameProfile}
            >
              Save
            </Button>
            <Button size="sm" variant="default" onClick={() => setRenamingProfile(false)}>
              Cancel
            </Button>
          </Group>
        ) : (
          <Group gap="xs">
            <Button size="sm" variant="default" onClick={() => setAddingProfile(true)}>
              New profile
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setNameDraft(active.name)
                setRenamingProfile(true)
              }}
            >
              Rename
            </Button>
          </Group>
        )}
      </Stack>

      <Stack gap="xs">
        <Text fw={600} size="sm">
          Plates
        </Text>
        <Text size="xs" c="dimmed">
          Count is the total plates owned, not per side.
        </Text>

        <Group gap="sm" wrap="nowrap">
          <Text size="xs" c="dimmed" w={120}>
            Denomination (kg)
          </Text>
          <Text size="xs" c="dimmed" w={100}>
            Count owned
          </Text>
        </Group>

        {plateRows.map((row) => {
          const error = plateErrors.get(row.key)
          const perSide = Math.floor(row.count / 2)
          return (
            <Group key={row.key} gap="sm" wrap="nowrap" align="center">
              <NumberInput
                aria-label="Denomination in kg"
                value={row.weight_kg}
                onChange={(value) => updatePlateRow(row.key, { weight_kg: toNumber(value) })}
                min={0.25}
                step={0.25}
                w={120}
                error={error !== undefined}
              />
              <NumberInput
                aria-label="Count owned"
                value={row.count}
                onChange={(value) => updatePlateRow(row.key, { count: toNumber(value) })}
                min={1}
                w={100}
                error={error !== undefined}
              />
              <Text size="xs" c="dimmed" flex={1}>
                {error ?? `${perSide} per side${row.count % 2 !== 0 ? ' (1 idle)' : ''}`}
              </Text>
              <ActionIcon
                variant="subtle"
                color="red"
                size="lg"
                onClick={() => removePlateRow(row.key)}
                aria-label="Remove plate"
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          )
        })}

        <Button
          variant="default"
          size="sm"
          leftSection={<IconPlus size={14} />}
          onClick={addPlateRow}
        >
          Add plate
        </Button>
      </Stack>

      <Stack gap="xs">
        <Text fw={600} size="sm">
          Bars
        </Text>

        <Group gap="sm" wrap="nowrap">
          <Text size="xs" c="dimmed" flex={1}>
            Name
          </Text>
          <Text size="xs" c="dimmed" w={100}>
            Weight (kg)
          </Text>
          <Text size="xs" c="dimmed" w={64}>
            Default
          </Text>
        </Group>

        {barRows.map((row) => {
          const error = barErrors.get(row.id)
          return (
            <Stack key={row.id} gap={2}>
              <Group gap="sm" wrap="nowrap" align="center">
                <TextInput
                  aria-label="Bar name"
                  value={row.name}
                  onChange={(e) => updateBarRow(row.id, { name: e.currentTarget.value })}
                  flex={1}
                  error={error !== undefined}
                />
                <NumberInput
                  aria-label="Bar weight in kg"
                  value={row.weight_kg}
                  onChange={(value) => updateBarRow(row.id, { weight_kg: toNumber(value) })}
                  min={0.25}
                  step={0.5}
                  w={100}
                  error={error !== undefined}
                />
                <Group w={64} justify="center">
                  <Radio
                    checked={defaultBarId === row.id}
                    onChange={() => setDefaultBar(row.id)}
                    aria-label={`Set ${row.name || 'bar'} as default`}
                  />
                </Group>
                <Tooltip label={barRows.length <= 1 ? "Can't delete the last bar" : 'Remove bar'}>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="lg"
                    disabled={barRows.length <= 1}
                    onClick={() => removeBarRow(row.id)}
                    aria-label="Remove bar"
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {error && (
                <Text size="xs" c="red">
                  {error}
                </Text>
              )}
            </Stack>
          )
        })}

        <Button
          variant="default"
          size="sm"
          leftSection={<IconPlus size={14} />}
          onClick={addBarRow}
        >
          Add bar
        </Button>
      </Stack>

      <Stack gap="xs">
        <Text fw={600} size="sm">
          Exercises
        </Text>
        <Text size="xs" c="dimmed">
          How each lift is assembled here. Barbell loads both sides on top of the bar; single is one
          hung or stacked weight; none is a plain keypad.
        </Text>

        {exercises.map((exercise) => {
          const mode = active.exercises[exercise.value]?.mode ?? 'free'
          return (
            <Group key={exercise.value} gap="sm" wrap="nowrap" align="center">
              <Text size="sm" flex={1}>
                {exercise.label}
              </Text>
              <SegmentedControl
                size="xs"
                value={mode}
                onChange={(next) =>
                  setExerciseLoading(exercise.value, { mode: next as LoadingMode })
                }
                data={MODE_OPTIONS}
                aria-label={`Loading mode for ${exercise.label}`}
              />
              <Select
                size="xs"
                w={150}
                aria-label={`Bar for ${exercise.label}`}
                disabled={mode !== 'barbell'}
                value={loadingFor(active, exercise.value).barId}
                onChange={(next) =>
                  next !== null && setExerciseLoading(exercise.value, { barId: next })
                }
                data={active.bars.map((bar) => ({ value: bar.id, label: bar.name }))}
                allowDeselect={false}
              />
            </Group>
          )
        })}
      </Stack>
    </Stack>
  )
}
