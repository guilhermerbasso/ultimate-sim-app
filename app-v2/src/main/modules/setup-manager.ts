import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import type { ModuleContext } from '../module-context'
import { diffSetups, parseSto } from '../../shared/sto-parser'
import {
  SETUP_MANAGER_CHANNELS,
  type SetupCompareArgs,
  type SetupCompareResult,
  type SetupLibraryItem,
  type SetupLibraryResult,
  type SetupMetaSaveArgs,
  type SetupMetadata,
  type SetupMetadataPatch,
  type SetupReadFileResult
} from '../../shared/setup-manager'

const META_FILE = 'setup-manager.json'
const MAX_SCAN_DEPTH = 4
const MAX_LIBRARY_ITEMS = 2000
const MAX_STO_BYTES = 50 * 1024 * 1024

interface MetadataStore {
  version: 1
  items: Record<string, SetupMetadata>
}

const DEFAULT_METADATA: SetupMetadata = {
  car: '',
  track: '',
  notes: '',
  tags: [],
  rating: 0,
  updatedAt: 0
}

let metadataStore: MetadataStore = { version: 1, items: {} }
let metadataReady: Promise<void> = Promise.resolve()

export function register(ctx: ModuleContext): void {
  const metaPath = join(ctx.app.getPath('userData'), META_FILE)

  metadataReady = loadMetadata(metaPath).then((loaded) => {
    metadataStore = loaded
  })

  ctx.ipcMain.handle(SETUP_MANAGER_CHANNELS.libraryList, async () => {
    await metadataReady
    return listLibrary(ctx)
  })
  ctx.ipcMain.handle(SETUP_MANAGER_CHANNELS.readFile, (_event, filePath: string) => readSetupFile(ctx, filePath))
  ctx.ipcMain.handle(SETUP_MANAGER_CHANNELS.compare, (_event, args: SetupCompareArgs) => compareSetups(ctx, args))
  ctx.ipcMain.handle(SETUP_MANAGER_CHANNELS.saveMeta, async (_event, args: SetupMetaSaveArgs) => {
    await metadataReady
    const item = await getLibraryItemByPath(ctx, args?.path)
    const key = normalizeKey(item.path)
    metadataStore.items[key] = mergeMetadata(item.metadata, args?.metadata ?? {})
    await saveMetadata(metaPath, metadataStore)
    return metadataStore.items[key]
  })
}

async function listLibrary(ctx: ModuleContext): Promise<SetupLibraryResult> {
  const root = getSetupsDir(ctx)
  const rootReal = await realpath(root).catch(() => '')
  if (!rootReal) return { root, items: [] }

  const paths: string[] = []
  await collectStoFiles(rootReal, rootReal, paths, 0)
  const items: SetupLibraryItem[] = []
  for (const filePath of paths.slice(0, MAX_LIBRARY_ITEMS)) {
    const item = await buildLibraryItem(rootReal, filePath).catch(() => null)
    if (item) items.push(item)
  }

  return { root, items: items.sort(sortLibraryItems) }
}

async function readSetupFile(ctx: ModuleContext, filePath: string): Promise<SetupReadFileResult> {
  const safePath = await validateSetupPath(ctx, filePath)
  const info = await stat(safePath)
  if (info.size > MAX_STO_BYTES) throw new Error('.sto file is too large.')
  return { path: safePath, text: await readFile(safePath, 'utf8') }
}

export async function compareSetups(ctx: ModuleContext, args: SetupCompareArgs): Promise<SetupCompareResult> {
  const [leftPath, rightPath] = await Promise.all([validateSetupPath(ctx, args?.leftPath), validateSetupPath(ctx, args?.rightPath)])
  const rootReal = await getExistingRoot(ctx)
  const [left, right, leftText, rightText] = await Promise.all([
    buildLibraryItem(rootReal, leftPath),
    buildLibraryItem(rootReal, rightPath),
    readSetupText(leftPath),
    readSetupText(rightPath)
  ])

  return { left, right, diff: diffSetups(parseSto(leftText), parseSto(rightText)) }
}

async function getLibraryItemByPath(ctx: ModuleContext, filePath: string): Promise<SetupLibraryItem> {
  const safePath = await validateSetupPath(ctx, filePath)
  return buildLibraryItem(await getExistingRoot(ctx), safePath)
}

async function readSetupText(filePath: string): Promise<string> {
  const info = await stat(filePath)
  if (!info.isFile() || info.size > MAX_STO_BYTES) throw new Error('Invalid .sto file.')
  return readFile(filePath, 'utf8')
}

async function collectStoFiles(rootReal: string, dir: string, files: string[], depth: number): Promise<void> {
  if (depth > MAX_SCAN_DEPTH || files.length >= MAX_LIBRARY_ITEMS) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (files.length >= MAX_LIBRARY_ITEMS) return
    const nextPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nextReal = await realpath(nextPath).catch(() => '')
      if (nextReal && isInsideRoot(rootReal, nextReal)) await collectStoFiles(rootReal, nextReal, files, depth + 1)
    } else if (entry.isFile() && hasStoExtension(entry.name)) {
      files.push(nextPath)
    }
  }
}

async function buildLibraryItem(rootReal: string, filePath: string): Promise<SetupLibraryItem> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('Invalid setup.')
  const relativePath = relative(rootReal, filePath)
  const segments = relativePath.split(sep).filter(Boolean)
  const key = normalizeKey(filePath)
  const metadata = metadataStore.items[key] ?? inferMetadata(segments)
  return {
    id: key,
    path: filePath,
    fileName: segments.at(-1) ?? filePath,
    relativePath,
    carFolder: segments.length > 1 ? segments[0] : undefined,
    sizeBytes: info.size,
    modifiedAt: info.mtimeMs,
    metadata
  }
}

async function validateSetupPath(ctx: ModuleContext, filePath: string | undefined): Promise<string> {
  if (typeof filePath !== 'string' || !hasStoExtension(filePath) || /[\u0000-\u001f\u007f]/.test(filePath)) {
    throw new Error('Invalid setup path.')
  }
  const rootReal = await getExistingRoot(ctx)
  const fileReal = await realpath(filePath).catch(() => '')
  if (!fileReal || !isInsideRoot(rootReal, fileReal)) throw new Error('Setup fora da biblioteca local.')
  const info = await stat(fileReal)
  if (!info.isFile() || info.size > MAX_STO_BYTES) throw new Error('Invalid .sto file.')
  return fileReal
}

async function getExistingRoot(ctx: ModuleContext): Promise<string> {
  const root = getSetupsDir(ctx)
  const rootReal = await realpath(root).catch(() => '')
  if (!rootReal) throw new Error('Local setups folder not found.')
  return rootReal
}

function getSetupsDir(ctx: ModuleContext): string {
  return join(ctx.app.getPath('documents'), 'iRacing', 'setups')
}

function isInsideRoot(rootReal: string, fileReal: string): boolean {
  const rel = relative(rootReal, fileReal)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !/^[a-zA-Z]:/.test(rel))
}

function hasStoExtension(value: string): boolean {
  return extname(value).toLowerCase() === '.sto'
}

function normalizeKey(filePath: string): string {
  return filePath.normalize('NFC')
}

function inferMetadata(segments: string[]): SetupMetadata {
  return { ...DEFAULT_METADATA, car: segments.length > 1 ? segments[0] : '', updatedAt: 0 }
}

function mergeMetadata(base: SetupMetadata, patch: SetupMetadataPatch): SetupMetadata {
  return {
    car: cleanText(patch.car, base.car),
    track: cleanText(patch.track, base.track),
    notes: cleanText(patch.notes, base.notes, 3000),
    tags: sanitizeTags(patch.tags ?? base.tags),
    rating: sanitizeRating(patch.rating, base.rating),
    updatedAt: Date.now()
  }
}

function cleanText(value: unknown, fallback: string, maxLength = 180): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) : fallback
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((tag) => cleanText(tag, '', 32)).filter(Boolean))).slice(0, 12)
}

function sanitizeRating(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(5, Math.round(value)))
}

function sortLibraryItems(a: SetupLibraryItem, b: SetupLibraryItem): number {
  return (a.carFolder ?? '').localeCompare(b.carFolder ?? '') || a.fileName.localeCompare(b.fileName)
}

async function loadMetadata(metaPath: string): Promise<MetadataStore> {
  try {
    const parsed = JSON.parse(await readFile(metaPath, 'utf8')) as Partial<MetadataStore>
    const items: Record<string, SetupMetadata> = {}
    for (const [key, value] of Object.entries(parsed.items ?? {})) items[key] = mergeMetadata(DEFAULT_METADATA, value)
    return { version: 1, items }
  } catch {
    return { version: 1, items: {} }
  }
}

async function saveMetadata(metaPath: string, store: MetadataStore): Promise<void> {
  await mkdir(dirname(metaPath), { recursive: true })
  await writeFile(metaPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}
