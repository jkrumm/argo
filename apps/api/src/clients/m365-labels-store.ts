import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../env.js'

// File-backed label store for M365 chats + channels. The live file is
// DATA_DIR/m365-labels.json (outside every release, so it survives `make deploy`
// and rollback). On first use it is seeded from the committed file
// apps/api/m365-labels.json. NO PII inside: chat thread IDs, display names
// (already-public Teams names), free-form tag + notes. Do NOT add emails.
// Writes are serialised (in-process mutex) and atomic (tmp + rename).

const moduleDir = dirname(fileURLToPath(import.meta.url))
// src/clients/m365-labels-store.ts → ../.. → apps/api root
const SEED_FILE = join(moduleDir, '..', '..', 'm365-labels.json')

export type LabelKind = 'chat' | 'channel'

export interface LabelRecord {
  sourceId: string
  kind: LabelKind
  label: string
  displayName: string | null
  notes: string | null
  updatedAt: string
}

interface FileShape {
  version: 1
  labels: Record<string, LabelRecord>
}

function emptyStore(): FileShape {
  return { version: 1, labels: {} }
}

export function createLabelsStore(dataDir: string, seedFile: string) {
  const file = join(dataDir, 'm365-labels.json')
  let tail: Promise<unknown> = Promise.resolve()
  let tmpCounter = 0

  function load(): FileShape {
    if (!existsSync(file)) {
      if (!existsSync(seedFile)) return emptyStore()
      mkdirSync(dataDir, { recursive: true })
      copyFileSync(seedFile, file)
    }
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<FileShape>
    if (!raw.labels) return emptyStore()
    return { version: 1, labels: raw.labels }
  }

  function save(store: FileShape): void {
    mkdirSync(dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n')
    renameSync(tmp, file)
  }

  /** Serialised read-modify-write: `fn` mutates the loaded store and returns the result plus whether to persist. */
  function mutate<T>(fn: (store: FileShape) => { result: T; changed: boolean }): Promise<T> {
    const run = tail.then(() => {
      const store = load()
      const { result, changed } = fn(store)
      if (changed) save(store)
      return result
    })
    tail = run.catch(() => undefined)
    return run
  }

  function listLabels(filter?: { label?: string }): LabelRecord[] {
    const rows = Object.values(load().labels)
    const filtered = filter?.label ? rows.filter((r) => r.label === filter.label) : rows
    return filtered.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  function upsertLabel(input: {
    sourceId: string
    kind: LabelKind
    label: string
    displayName: string | null
    notes: string | null
  }): Promise<LabelRecord> {
    return mutate((store) => {
      const record: LabelRecord = {
        sourceId: input.sourceId,
        kind: input.kind,
        label: input.label,
        displayName: input.displayName,
        notes: input.notes,
        updatedAt: new Date().toISOString(),
      }
      store.labels[input.sourceId] = record
      return { result: record, changed: true }
    })
  }

  function deleteLabel(sourceId: string): Promise<boolean> {
    return mutate((store) => {
      if (!(sourceId in store.labels)) return { result: false, changed: false }
      delete store.labels[sourceId]
      return { result: true, changed: true }
    })
  }

  /**
   * Rename a tag everywhere — every source carrying `from` switches to `to`.
   * Returns the number of records updated.
   */
  function renameTag(from: string, to: string): Promise<number> {
    return mutate((store) => {
      const now = new Date().toISOString()
      let n = 0
      for (const r of Object.values(store.labels)) {
        if (r.label === from) {
          r.label = to
          r.updatedAt = now
          n++
        }
      }
      return { result: n, changed: n > 0 }
    })
  }

  /** Drop a tag from every source carrying it. Returns number of records removed. */
  function deleteTag(tag: string): Promise<number> {
    return mutate((store) => {
      let n = 0
      for (const [id, r] of Object.entries(store.labels)) {
        if (r.label === tag) {
          delete store.labels[id]
          n++
        }
      }
      return { result: n, changed: n > 0 }
    })
  }

  return { file, listLabels, upsertLabel, deleteLabel, renameTag, deleteTag }
}

const labelsStore = createLabelsStore(env.DATA_DIR, SEED_FILE)

export const { listLabels, upsertLabel, deleteLabel, renameTag, deleteTag } = labelsStore
