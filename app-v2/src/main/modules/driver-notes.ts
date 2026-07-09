import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  DRIVER_NOTES_CHANNELS,
  DRIVER_TAG_OPTIONS,
  type DriverNote,
  type DriverNoteInput,
  type DriverNotesListResult,
  type DriverTag
} from '../../shared/driver-notes'
import type { ModuleContext } from '../module-context'

interface DriverNotesFile {
  version: 1
  notes: DriverNote[]
}

const NOTES_FILE = 'driver-notes.json'
const DEFAULT_TAG = 'none'

export function register(ctx: ModuleContext): void {
  const store = new DriverNotesStore(ctx, join(ctx.app.getPath('userData'), NOTES_FILE))

  void store.load()

  ctx.ipcMain.handle(DRIVER_NOTES_CHANNELS.list, async (): Promise<DriverNotesListResult> => {
    await store.ready()
    return { notes: store.list() }
  })

  ctx.ipcMain.handle(DRIVER_NOTES_CHANNELS.set, async (_event, input: DriverNoteInput): Promise<DriverNote> => {
    await store.ready()
    return store.set(input)
  })

  ctx.ipcMain.handle(DRIVER_NOTES_CHANNELS.remove, async (_event, custId: number): Promise<DriverNotesListResult> => {
    await store.ready()
    await store.remove(custId)
    return { notes: store.list() }
  })
}

class DriverNotesStore {
  private readonly ctx: ModuleContext
  private readonly filePath: string
  private readonly notes = new Map<number, DriverNote>()
  private loadPromise: Promise<void> | null = null

  constructor(ctx: ModuleContext, filePath: string) {
    this.ctx = ctx
    this.filePath = filePath
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk()
    }
    return this.loadPromise
  }

  ready(): Promise<void> {
    return this.load()
  }

  list(): DriverNote[] {
    return [...this.notes.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async set(input: DriverNoteInput): Promise<DriverNote> {
    const custId = Number(input?.custId)
    if (!Number.isInteger(custId) || custId <= 0) {
      throw new Error('Invalid custId.')
    }

    const tag = DRIVER_TAG_OPTIONS.includes(input.tag) ? input.tag : DEFAULT_TAG
    const noteText = normalizeOptionalText(input.note)
    const color = normalizeOptionalText(input.color)
    const next: DriverNote = {
      custId,
      tag,
      ...(noteText ? { note: noteText } : {}),
      ...(color ? { color } : {}),
      updatedAt: Date.now()
    }

    this.notes.set(custId, next)
    await this.save()
    this.broadcast()
    return next
  }

  async remove(custIdInput: number): Promise<void> {
    const custId = Number(custIdInput)
    if (!Number.isInteger(custId) || custId <= 0) {
      throw new Error('Invalid custId.')
    }
    this.notes.delete(custId)
    await this.save()
    this.broadcast()
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const notes = parseNotesFile(parsed)
      this.notes.clear()
      for (const note of notes) {
        this.notes.set(note.custId, note)
      }
    } catch {
      this.notes.clear()
    }
  }

  private async save(): Promise<void> {
    const payload: DriverNotesFile = { version: 1, notes: this.list() }
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  private broadcast(): void {
    this.ctx.broadcast(DRIVER_NOTES_CHANNELS.updated, { notes: this.list() })
  }
}

function parseNotesFile(parsed: unknown): DriverNote[] {
  const rawNotes = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.notes)
      ? parsed.notes
      : []

  return rawNotes.flatMap((raw) => {
    if (!isObject(raw)) return []
    const custId = Number(raw.custId)
    const updatedAt = Number(raw.updatedAt)
    if (!Number.isInteger(custId) || custId <= 0) return []
    const tag = isDriverTag(raw.tag) ? raw.tag : DEFAULT_TAG
    return [{
      custId,
      tag,
      ...(normalizeOptionalText(raw.note) ? { note: normalizeOptionalText(raw.note) } : {}),
      ...(normalizeOptionalText(raw.color) ? { color: normalizeOptionalText(raw.color) } : {}),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now()
    }]
  })
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isDriverTag(value: unknown): value is DriverTag {
  return typeof value === 'string' && DRIVER_TAG_OPTIONS.includes(value as DriverTag)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
