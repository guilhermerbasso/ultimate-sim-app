import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { SimId, TelemetrySnapshot } from '../../shared/telemetry'
import { parseSto } from '../../shared/sto-parser'
import {
  COMMUNITY_CHANNELS,
  SHARE_PACK_EXTENSION,
  SHARE_PACK_MAGIC,
  SHARE_PACK_VERSION,
  buildGhostLap,
  compareGhosts,
  parseSharePack,
  serializeSharePack,
  summarizeSharePack,
  type CommunityExportOptions,
  type CommunityExportResult,
  type CommunityImportResult,
  type CommunityStatus,
  type GhostCompareReport,
  type RawGhostSample,
  type SharePack,
  type SharePackSummary,
  type TelemetrySeries,
  type TelemetrySeriesSample
} from '../../shared/community'

// Reject an untrusted imported .simshare larger than this before reading it.
const MAX_IMPORT_BYTES = 32 * 1024 * 1024
const SOURCES_FILE = 'community-sources.json'

type CommunitySourceSim = Extract<SimId, 'iracing' | 'acc' | 'ac' | 'ams2' | 'lmu'>
type CommunitySourceKind = 'telemetry' | 'setup' | 'community'

interface CommunitySource {
  id: string
  sim: CommunitySourceSim
  kind: CommunitySourceKind
  name: string
  url: string
  description: string
}

const COMMUNITY_SOURCE_CHANNELS = {
  list: 'community:sources:list',
  add: 'community:sources:add',
  remove: 'community:sources:remove',
  reset: 'community:sources:reset'
} as const

const CURATED_COMMUNITY_SOURCES: CommunitySource[] = [
  {
    id: 'iracing-garage-61',
    sim: 'iracing',
    kind: 'telemetry',
    name: 'Garage 61',
    url: 'https://garage61.net/',
    description: 'iRacing telemetry, setup comparison and shared laps.'
  },
  {
    id: 'iracing-majors-garage',
    sim: 'iracing',
    kind: 'setup',
    name: 'Majors Garage',
    url: 'https://majorsgarage.com/',
    description: 'Widely used iRacing setup shop/community resource.'
  },
  {
    id: 'iracing-virtual-racing-school',
    sim: 'iracing',
    kind: 'telemetry',
    name: 'Virtual Racing School',
    url: 'https://virtualracingschool.com/',
    description: 'iRacing telemetry analysis, data packs and coaching resources.'
  },
  {
    id: 'acc-coach-dave-academy',
    sim: 'acc',
    kind: 'setup',
    name: 'Coach Dave Academy',
    url: 'https://coachdaveacademy.com/',
    description: 'ACC setup packs, telemetry-oriented coaching and guides.'
  },
  {
    id: 'acc-low-fuel-motorsport',
    sim: 'acc',
    kind: 'community',
    name: 'Low Fuel Motorsport',
    url: 'https://lowfuelmotorsport.com/',
    description: 'ACC leagues, rankings and community knowledge base.'
  },
  {
    id: 'ac-overtake',
    sim: 'ac',
    kind: 'community',
    name: 'OverTake Assetto Corsa',
    url: 'https://www.overtake.gg/',
    description: 'Long-running Assetto Corsa community with setups, tracks and guides.'
  },
  {
    id: 'ac-racedepartment',
    sim: 'ac',
    kind: 'setup',
    name: 'RaceDepartment / OverTake forums',
    url: 'https://www.overtake.gg/forums/assetto-corsa.130/',
    description: 'Assetto Corsa forum area for setup discussion and shared resources.'
  },
  {
    id: 'ams2-reiza-forum',
    sim: 'ams2',
    kind: 'community',
    name: 'Reiza Studios Forum',
    url: 'https://forum.reizastudios.com/',
    description: 'Official AMS2 community hub with car, setup and telemetry discussions.'
  },
  {
    id: 'ams2-overtake',
    sim: 'ams2',
    kind: 'setup',
    name: 'OverTake Automobilista 2',
    url: 'https://www.overtake.gg/forums/automobilista-2.541/',
    description: 'AMS2 community forum with setup and racing resources.'
  },
  {
    id: 'lmu-studio-397-forum',
    sim: 'lmu',
    kind: 'community',
    name: 'Studio 397 Forum',
    url: 'https://forum.studio-397.com/',
    description: 'Official Le Mans Ultimate / rFactor ecosystem community forum.'
  },
  {
    id: 'lmu-overtake',
    sim: 'lmu',
    kind: 'setup',
    name: 'OverTake Le Mans Ultimate',
    url: 'https://www.overtake.gg/forums/le-mans-ultimate.777/',
    description: 'LMU community forum for setups, guides and shared resources.'
  }
]

// ─────────────────────────────────────────────────────────────────────────────
// Community — LOCAL-FIRST sharing.
//
// A LIVE community network needs a server, which contradicts this app's 100%-
// local promise, so it is intentionally OUT OF SCOPE here. This module builds the
// foundation: it lets the driver EXPORT a ghost lap, a telemetry series or a
// setup to a portable `.simshare` FILE, IMPORT files shared by others, and
// COMPARE the current/last lap against an imported ghost — all on disk, no
// account, no network.
//
// The seam for a future backend is the `CommunityBackend` interface below. Today
// the only implementation is `LocalBackend` (userData files). A `NetworkBackend`
// can be dropped in later WITHOUT touching the IPC layer or the renderer — see
// the TODO next to the interface.
//
// This module owns all side effects (clock, randomUUID, filesystem, dialogs);
// the deterministic format/compare logic lives in src/shared/community.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Live-capture tuning. Mirrors the recorder's lap-wrap detection so a captured
// ghost lines up with how the rest of the app sees a lap.
const SAMPLE_MIN_INTERVAL_MS = 60 // ~15 Hz cap on the live capture
const LAP_WRAP_HIGH = 0.82
const LAP_WRAP_LOW = 0.18
const GHOST_MIN_SAMPLES = 30 // ignore partial/in/out laps with too little data
const MAX_LAP_SAMPLES = 6000 // hard cap so a parked car can't grow unbounded
const MAX_TELEMETRY_SAMPLES = 2700 // rolling window (~3 min at 15 Hz)

// ─── Backend seam ───────────────────────────────────────────────────────────
// The ONLY contract the IPC layer depends on. Keep it transport-agnostic: a
// future network backend implements the same shape (with auth handled inside).
//
// TODO(community-network): add `NetworkBackend implements CommunityBackend` that
// talks to an opt-in server (publish/browse/download). The IPC handlers and the
// renderer below must NOT change — only the concrete backend wired in `register`
// (e.g. behind a user setting) would differ. Keep `list/get/save/remove` async so
// a remote implementation drops in cleanly.
export interface CommunityBackend {
  readonly kind: 'local' | 'network'
  list(): Promise<SharePackSummary[]>
  get(id: string): Promise<SharePack | null>
  save(pack: SharePack): Promise<SharePackSummary>
  remove(id: string): Promise<boolean>
}

// Local-disk implementation: one `<id>.simshare` JSON file per pack under
// `userData/community`. Every imported/exported pack is re-keyed with a fresh
// local id so the on-disk filename is always safe and unique.
class LocalBackend implements CommunityBackend {
  readonly kind = 'local' as const
  private readonly dir: string

  constructor(userData: string) {
    this.dir = join(userData, 'community')
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.${SHARE_PACK_EXTENSION}`)
  }

  private static safeId(id: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(id)
  }

  async list(): Promise<SharePackSummary[]> {
    await mkdir(this.dir, { recursive: true })
    const entries = await readdir(this.dir).catch(() => [] as string[])
    const summaries: SharePackSummary[] = []
    for (const name of entries) {
      if (!name.endsWith(`.${SHARE_PACK_EXTENSION}`)) continue
      try {
        const raw = await readFile(join(this.dir, name), 'utf8')
        summaries.push(summarizeSharePack(parseSharePack(raw)))
      } catch {
        // Skip unreadable/corrupt files rather than failing the whole listing.
      }
    }
    return summaries.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(id: string): Promise<SharePack | null> {
    if (!LocalBackend.safeId(id)) return null
    try {
      return parseSharePack(await readFile(this.fileFor(id), 'utf8'))
    } catch {
      return null
    }
  }

  async save(pack: SharePack): Promise<SharePackSummary> {
    await mkdir(this.dir, { recursive: true })
    // Re-key with a fresh local id so a foreign/oddly-named pack can never write
    // outside the community dir and ids stay unique on this machine.
    const stored: SharePack = { ...pack, id: randomUUID() }
    await writeFile(this.fileFor(stored.id), `${serializeSharePack(stored)}\n`, 'utf8')
    return summarizeSharePack(stored)
  }

  async remove(id: string): Promise<boolean> {
    if (!LocalBackend.safeId(id)) return false
    try {
      await unlink(this.fileFor(id))
      return true
    } catch {
      return false
    }
  }
}

class CommunitySourceStore {
  private readonly filePath: string

  constructor(userData: string) {
    this.filePath = join(userData, SOURCES_FILE)
  }

  async list(): Promise<CommunitySource[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sanitizeSourceList(JSON.parse(raw))
    } catch {
      // Missing or corrupt source config: fall back to the curated safe defaults.
    }
    await this.save(CURATED_COMMUNITY_SOURCES)
    return [...CURATED_COMMUNITY_SOURCES]
  }

  async add(input: unknown): Promise<CommunitySource[]> {
    const source = sanitizeSource(input, true)
    const sources = await this.list()
    const next = [...sources.filter((item) => item.id !== source.id), source]
    await this.save(next)
    return next
  }

  async remove(id: unknown): Promise<CommunitySource[]> {
    if (typeof id !== 'string') throw new Error('id inválido')
    const sources = await this.list()
    const next = sources.filter((source) => source.id !== id)
    await this.save(next)
    return next
  }

  async reset(): Promise<CommunitySource[]> {
    await this.save(CURATED_COMMUNITY_SOURCES)
    return [...CURATED_COMMUNITY_SOURCES]
  }

  private async save(sources: CommunitySource[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(sources, null, 2)}\n`, 'utf8')
  }
}

function isCommunitySourceSim(value: unknown): value is CommunitySourceSim {
  return value === 'iracing' || value === 'acc' || value === 'ac' || value === 'ams2' || value === 'lmu'
}

function isCommunitySourceKind(value: unknown): value is CommunitySourceKind {
  return value === 'telemetry' || value === 'setup' || value === 'community'
}

function safeText(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function safeSourceUrl(value: unknown): string {
  const raw = safeText(value, 500)
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') throw new Error('Fonte precisa usar HTTPS.')
    url.hash = ''
    return url.toString()
  } catch {
    throw new Error('URL de fonte inválida ou sem HTTPS.')
  }
}

function sourceIdFrom(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
}

function sanitizeSource(input: unknown, allowGeneratedId = false): CommunitySource {
  const value = (input ?? {}) as Partial<CommunitySource>
  const sim = isCommunitySourceSim(value.sim) ? value.sim : null
  const kind = isCommunitySourceKind(value.kind) ? value.kind : null
  const name = safeText(value.name, 80)
  const url = safeSourceUrl(value.url)
  if (!sim || !kind || !name) throw new Error('Fonte de comunidade incompleta.')
  const id = sourceIdFrom(safeText(value.id, 90)) || (allowGeneratedId ? sourceIdFrom(`${sim}-${kind}-${name}`) : '')
  if (!id) throw new Error('id de fonte inválido.')
  return {
    id,
    sim,
    kind,
    name,
    url,
    description: safeText(value.description, 220)
  }
}

function sanitizeSourceList(input: unknown): CommunitySource[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const sources: CommunitySource[] = []
  for (const item of input) {
    try {
      const source = sanitizeSource(item)
      if (seen.has(source.id)) continue
      seen.add(source.id)
      sources.push(source)
    } catch {
      // Drop one bad saved/custom source without losing the rest.
    }
  }
  return sources
}

// ─── Live telemetry capture ─────────────────────────────────────────────────
// Buffers the current lap into a ghost (finalized on each lap completion) and
// keeps a rolling telemetry window. Read-only on the telemetry hub; never writes.

interface CapturedLap {
  samples: RawGhostSample[]
  lapTimeSec?: number
  sim: SimId
  car?: string
  track?: string
  startedAt: number
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

class LiveCapture {
  private currentSamples: RawGhostSample[] = []
  private currentStartedAt = 0
  private lastLapDistPct: number | null = null
  private lastLapNumber: number | undefined
  private lastSampleAt = 0
  private lastGhost: CapturedLap | null = null
  private context: { sim: SimId; car?: string; track?: string } = { sim: 'none' }
  private readonly telemetry: Array<TelemetrySeriesSample & { ts: number }> = []

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!snapshot?.connected) return
    const dist = finiteOrUndefined(snapshot.lapDistPct)
    if (dist === undefined) return
    const clampedDist = Math.max(0, Math.min(1, dist))
    const now = finiteOrUndefined(snapshot.timestamp) ?? Date.now()
    if (this.lastSampleAt && now - this.lastSampleAt < SAMPLE_MIN_INTERVAL_MS) return
    this.lastSampleAt = now

    this.context = {
      sim: snapshot.sim,
      car: snapshot.carName?.trim() || this.context.car,
      track: snapshot.trackName?.trim() || this.context.track
    }

    this.captureTelemetry(snapshot, now)
    this.detectLapBoundary(snapshot, clampedDist, now)

    if (this.currentSamples.length < MAX_LAP_SAMPLES) {
      this.currentSamples.push({
        lapDistPct: clampedDist,
        speedKmh: Math.max(0, snapshot.speedKmh),
        throttle: snapshot.throttle,
        brake: snapshot.brake,
        steer: finiteOrUndefined(snapshot.steerAngleDeg),
        rpm: finiteOrUndefined(snapshot.rpm),
        gear: finiteOrUndefined(snapshot.gear),
        currentLapTimeSec: finiteOrUndefined(snapshot.currentLapTimeSec)
      })
    }

    this.lastLapDistPct = clampedDist
    this.lastLapNumber = finiteOrUndefined(snapshot.currentLap)
  }

  private detectLapBoundary(snapshot: TelemetrySnapshot, dist: number, now: number): void {
    if (this.currentStartedAt === 0) this.currentStartedAt = now
    const lapNumber = finiteOrUndefined(snapshot.currentLap)
    const lapNumberChanged =
      lapNumber !== undefined && this.lastLapNumber !== undefined && lapNumber > this.lastLapNumber
    const wrapped = this.lastLapDistPct !== null && this.lastLapDistPct > LAP_WRAP_HIGH && dist < LAP_WRAP_LOW
    if (!wrapped && !lapNumberChanged) return

    if (this.currentSamples.length >= GHOST_MIN_SAMPLES) {
      this.lastGhost = {
        samples: this.currentSamples,
        lapTimeSec: finiteOrUndefined(snapshot.lastLapTimeSec),
        sim: this.context.sim,
        car: this.context.car,
        track: this.context.track,
        startedAt: this.currentStartedAt
      }
    }
    this.currentSamples = []
    this.currentStartedAt = now
  }

  private captureTelemetry(snapshot: TelemetrySnapshot, now: number): void {
    this.telemetry.push({
      ts: now,
      t: 0,
      lapDistPct: finiteOrUndefined(snapshot.lapDistPct),
      speedKmh: finiteOrUndefined(snapshot.speedKmh),
      rpm: finiteOrUndefined(snapshot.rpm),
      gear: finiteOrUndefined(snapshot.gear),
      throttle: finiteOrUndefined(snapshot.throttle),
      brake: finiteOrUndefined(snapshot.brake),
      steer: finiteOrUndefined(snapshot.steerAngleDeg)
    })
    if (this.telemetry.length > MAX_TELEMETRY_SAMPLES) this.telemetry.shift()
  }

  getLastGhost(): CapturedLap | null {
    return this.lastGhost
  }

  getContext(): { sim: SimId; car?: string; track?: string } {
    return this.context
  }

  // Snapshot-series for the rolling window, with `t` normalized to the first
  // sample. Strips the internal `ts` field. Returns null when nothing buffered.
  getTelemetrySeries(): TelemetrySeries | null {
    if (this.telemetry.length === 0) return null
    const start = this.telemetry[0].ts
    const samples: TelemetrySeriesSample[] = this.telemetry.map(({ ts, ...rest }) => ({
      ...rest,
      t: Math.max(0, ts - start)
    }))
    const durationSec = (this.telemetry[this.telemetry.length - 1].ts - start) / 1000
    return { durationSec, sampleCount: samples.length, samples }
  }

  getStatus(): Pick<CommunityStatus, 'liveGhostReady' | 'liveLapTimeSec' | 'sim' | 'car' | 'track' | 'liveSampleCount' | 'telemetryReady' | 'telemetrySampleCount'> {
    const ghost = this.lastGhost
    return {
      liveGhostReady: ghost !== null,
      liveLapTimeSec: ghost?.lapTimeSec,
      sim: this.context.sim === 'none' ? undefined : this.context.sim,
      car: ghost?.car ?? this.context.car,
      track: ghost?.track ?? this.context.track,
      liveSampleCount: ghost?.samples.length ?? 0,
      telemetryReady: this.telemetry.length > 0,
      telemetrySampleCount: this.telemetry.length
    }
  }
}

// ─── Pack builders ──────────────────────────────────────────────────────────

function basePackMeta(
  appVersion: string,
  ctx: { sim?: SimId; car?: string; track?: string },
  opts?: CommunityExportOptions
): SharePack['meta'] {
  const meta: SharePack['meta'] = { createdAt: Date.now(), appVersion }
  if (ctx.sim && ctx.sim !== 'none') meta.sim = ctx.sim
  if (ctx.car) meta.car = ctx.car
  if (ctx.track) meta.track = ctx.track
  if (opts?.author?.trim()) meta.author = opts.author.trim()
  if (opts?.note?.trim()) meta.note = opts.note.trim()
  return meta
}

function ghostPackFrom(lap: CapturedLap, appVersion: string, opts?: CommunityExportOptions): SharePack {
  return {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind: 'ghost',
    id: randomUUID(),
    meta: basePackMeta(appVersion, lap, opts),
    ghost: buildGhostLap(lap.samples, { lapTimeSec: lap.lapTimeSec })
  }
}

function telemetryPackFrom(
  series: TelemetrySeries,
  appVersion: string,
  ctx: { sim?: SimId; car?: string; track?: string },
  opts?: CommunityExportOptions
): SharePack {
  return {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind: 'telemetry',
    id: randomUUID(),
    meta: basePackMeta(appVersion, ctx, opts),
    telemetry: series
  }
}

function setupPackFrom(
  raw: string,
  fileName: string,
  appVersion: string,
  ctx: { sim?: SimId; car?: string; track?: string },
  opts?: CommunityExportOptions
): SharePack {
  return {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind: 'setup',
    id: randomUUID(),
    meta: basePackMeta(appVersion, ctx, opts),
    setup: { format: 'sto', fileName, raw, sections: parseSto(raw).sections }
  }
}

// ─── Dialog helpers ─────────────────────────────────────────────────────────

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

const SIMSHARE_FILTER = [{ name: 'Sim Racing share pack', extensions: [SHARE_PACK_EXTENSION] }]
const STO_FILTER = [{ name: 'iRacing setup', extensions: ['sto'] }]

function slug(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function defaultExportName(kind: SharePack['kind'], ctx: { car?: string; track?: string }): string {
  const parts = [slug(ctx.track), slug(ctx.car), kind].filter(Boolean)
  const stem = parts.join('-') || kind
  return `${stem}-${dateStamp()}.${SHARE_PACK_EXTENSION}`
}

// ─── Module registration ────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  const userData = ctx.app.getPath('userData')
  const backend: CommunityBackend = new LocalBackend(userData)
  const sourceStore = new CommunitySourceStore(userData)
  const capture = new LiveCapture()
  const appVersion = ctx.app.getVersion()

  ctx.telemetryHub.on('snapshot', (snapshot) => capture.onSnapshot(snapshot))

  const showSave = (opts: SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
    const win = ctx.getMainWindow()
    return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
  }
  const showOpen = (opts: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
    const win = ctx.getMainWindow()
    return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
  }

  const writePack = async (pack: SharePack, defaultName: string): Promise<CommunityExportResult> => {
    const result = await showSave({ title: 'Exportar para arquivo .simshare', defaultPath: defaultName, filters: SIMSHARE_FILTER })
    if (result.canceled || !result.filePath) return { canceled: true }
    await writeFile(result.filePath, `${serializeSharePack(pack)}\n`, 'utf8')
    return { canceled: false, filePath: result.filePath, id: pack.id, kind: pack.kind }
  }

  ctx.ipcMain.handle(COMMUNITY_CHANNELS.status, async (): Promise<CommunityStatus> => {
    const imported = await backend.list()
    return { ...capture.getStatus(), importedCount: imported.length }
  })

  ctx.ipcMain.handle(
    COMMUNITY_CHANNELS.exportGhost,
    async (_event, opts?: CommunityExportOptions): Promise<CommunityExportResult> => {
      const lap = capture.getLastGhost()
      if (!lap) throw new Error('Nenhuma volta completa capturada ainda. Complete uma volta limpa e tente de novo.')
      const pack = ghostPackFrom(lap, appVersion, opts)
      return writePack(pack, defaultExportName('ghost', lap))
    }
  )

  ctx.ipcMain.handle(
    COMMUNITY_CHANNELS.exportTelemetry,
    async (_event, opts?: CommunityExportOptions): Promise<CommunityExportResult> => {
      const series = capture.getTelemetrySeries()
      if (!series) throw new Error('Sem telemetria capturada ainda. Entre na pista e tente de novo.')
      const context = capture.getContext()
      const pack = telemetryPackFrom(series, appVersion, context, opts)
      return writePack(pack, defaultExportName('telemetry', context))
    }
  )

  ctx.ipcMain.handle(
    COMMUNITY_CHANNELS.exportSetup,
    async (_event, opts?: CommunityExportOptions & { sto?: string; fileName?: string }): Promise<CommunityExportResult> => {
      let raw = typeof opts?.sto === 'string' ? opts.sto : ''
      let fileName = opts?.fileName ?? 'setup.sto'
      if (!raw) {
        const picked = await showOpen({ title: 'Escolher setup (.sto) para compartilhar', properties: ['openFile'], filters: STO_FILTER })
        if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
        raw = await readFile(picked.filePaths[0], 'utf8')
        fileName = picked.filePaths[0].split(/[\\/]/).pop() ?? fileName
      }
      const pack = setupPackFrom(raw, fileName, appVersion, capture.getContext(), opts)
      return writePack(pack, defaultExportName('setup', capture.getContext()))
    }
  )

  ctx.ipcMain.handle(COMMUNITY_CHANNELS.import, async (): Promise<CommunityImportResult> => {
    const picked = await showOpen({ title: 'Importar arquivo .simshare', properties: ['openFile'], filters: SIMSHARE_FILTER })
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
    // Reject an absurdly large (untrusted) file before reading it into memory.
    const info = await stat(picked.filePaths[0])
    if (info.size > MAX_IMPORT_BYTES) throw new Error('Arquivo .simshare muito grande (máx. 32 MB).')
    const raw = await readFile(picked.filePaths[0], 'utf8')
    const pack = parseSharePack(raw) // throws on wrong magic/version/structure
    const summary = await backend.save(pack)
    ctx.broadcast(COMMUNITY_CHANNELS.changed, { action: 'import', id: summary.id })
    return { canceled: false, summary }
  })

  ctx.ipcMain.handle(COMMUNITY_CHANNELS.listLocal, (): Promise<SharePackSummary[]> => backend.list())
  ctx.ipcMain.handle(COMMUNITY_SOURCE_CHANNELS.list, (): Promise<CommunitySource[]> => sourceStore.list())
  ctx.ipcMain.handle(COMMUNITY_SOURCE_CHANNELS.add, (_event, source: unknown): Promise<CommunitySource[]> => sourceStore.add(source))
  ctx.ipcMain.handle(COMMUNITY_SOURCE_CHANNELS.remove, (_event, id: unknown): Promise<CommunitySource[]> => sourceStore.remove(id))
  ctx.ipcMain.handle(COMMUNITY_SOURCE_CHANNELS.reset, (): Promise<CommunitySource[]> => sourceStore.reset())

  ctx.ipcMain.handle(COMMUNITY_CHANNELS.get, (_event, id: string): Promise<SharePack | null> => {
    if (typeof id !== 'string') throw new Error('id inválido')
    return backend.get(id)
  })

  ctx.ipcMain.handle(COMMUNITY_CHANNELS.delete, async (_event, id: string): Promise<boolean> => {
    if (typeof id !== 'string') throw new Error('id inválido')
    const removed = await backend.remove(id)
    if (removed) ctx.broadcast(COMMUNITY_CHANNELS.changed, { action: 'delete', id })
    return removed
  })

  // Compare the live/last lap (or another imported ghost) against an imported
  // ghost. Negative deltas = the baseline is FASTER than the target.
  ctx.ipcMain.handle(
    COMMUNITY_CHANNELS.compareTo,
    async (_event, targetId: string, baselineId?: string): Promise<GhostCompareReport> => {
      if (typeof targetId !== 'string') throw new Error('id do ghost inválido')
      const target = await backend.get(targetId)
      if (!target?.ghost) throw new Error('Ghost importado não encontrado (ou não é um ghost).')

      let baselineGhost = target.ghost // placeholder, replaced below
      let baselineSource: 'live' | 'imported'
      let baselineLabel: string

      if (typeof baselineId === 'string' && baselineId.length > 0) {
        const baseline = await backend.get(baselineId)
        if (!baseline?.ghost) throw new Error('Ghost de comparação não encontrado.')
        baselineGhost = baseline.ghost
        baselineSource = 'imported'
        baselineLabel = ghostLabel(summarizeSharePack(baseline))
      } else {
        const lap = capture.getLastGhost()
        if (!lap) throw new Error('Nenhuma volta sua capturada ainda. Complete uma volta para comparar.')
        baselineGhost = buildGhostLap(lap.samples, { lapTimeSec: lap.lapTimeSec })
        baselineSource = 'live'
        baselineLabel = `Sua volta${lap.lapTimeSec ? ` · ${formatLapTime(lap.lapTimeSec)}` : ''}`
      }

      return {
        result: compareGhosts(baselineGhost, target.ghost),
        targetId,
        targetLabel: ghostLabel(summarizeSharePack(target)),
        baselineLabel,
        baselineSource
      }
    }
  )
}

function ghostLabel(summary: SharePackSummary): string {
  const bits = [summary.track, summary.car].filter(Boolean)
  const head = bits.join(' · ') || summary.author || 'Ghost'
  return summary.lapTimeSec ? `${head} · ${formatLapTime(summary.lapTimeSec)}` : head
}

function formatLapTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
