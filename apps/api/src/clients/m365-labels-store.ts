import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// File-backed label store for M365 chats + channels. The file is COMMITTED to
// git (apps/api/m365-labels.json) — it's the source of truth for which Teams
// chats/channels matter, hand-editable, version-controlled, and baked into the
// prod image at build time. NO PII inside: chat thread IDs, display names
// (already-public Teams names), free-form tag + notes. Do NOT add emails.

const moduleDir = dirname(fileURLToPath(import.meta.url))
// src/clients/m365-labels-store.ts → ../.. → apps/api root
const LABELS_FILE = join(moduleDir, '..', '..', 'm365-labels.json')

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

function load(): FileShape {
  if (!existsSync(LABELS_FILE)) return emptyStore()
  const raw = JSON.parse(readFileSync(LABELS_FILE, 'utf-8')) as Partial<FileShape>
  if (!raw.labels) return emptyStore()
  return { version: 1, labels: raw.labels }
}

function save(store: FileShape): void {
  writeFileSync(LABELS_FILE, JSON.stringify(store, null, 2) + '\n')
}

export function listLabels(filter?: { label?: string }): LabelRecord[] {
  const rows = Object.values(load().labels)
  const filtered = filter?.label ? rows.filter((r) => r.label === filter.label) : rows
  return filtered.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function upsertLabel(input: {
  sourceId: string
  kind: LabelKind
  label: string
  displayName: string | null
  notes: string | null
}): LabelRecord {
  const store = load()
  const record: LabelRecord = {
    sourceId: input.sourceId,
    kind: input.kind,
    label: input.label,
    displayName: input.displayName,
    notes: input.notes,
    updatedAt: new Date().toISOString(),
  }
  store.labels[input.sourceId] = record
  save(store)
  return record
}

export function deleteLabel(sourceId: string): boolean {
  const store = load()
  if (!(sourceId in store.labels)) return false
  delete store.labels[sourceId]
  save(store)
  return true
}

/**
 * Rename a tag everywhere — every source carrying `from` switches to `to`.
 * Returns the number of records updated.
 */
export function renameTag(from: string, to: string): number {
  const store = load()
  const now = new Date().toISOString()
  let n = 0
  for (const r of Object.values(store.labels)) {
    if (r.label === from) {
      r.label = to
      r.updatedAt = now
      n++
    }
  }
  if (n > 0) save(store)
  return n
}

/** Drop a tag from every source carrying it. Returns number of records removed. */
export function deleteTag(tag: string): number {
  const store = load()
  let n = 0
  for (const [id, r] of Object.entries(store.labels)) {
    if (r.label === tag) {
      delete store.labels[id]
      n++
    }
  }
  if (n > 0) save(store)
  return n
}
