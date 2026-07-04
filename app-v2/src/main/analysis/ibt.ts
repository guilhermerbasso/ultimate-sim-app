import { open, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// ─────────────────────────────────────────────────────────────────────────────
// Parser de telemetria iRacing (.ibt).
//
// Layout do arquivo (igual ao MMF irsdk, mas persistido em disco com um
// `irsdk_diskSubHeader` extra logo depois do header principal):
//
//   bytes 0..111   irsdk_header                (112 B)
//     int32 ver, status, tickRate,
//     int32 sessionInfoUpdate, sessionInfoLen, sessionInfoOffset,
//     int32 numVars, varHeaderOffset, numBuf, bufLen,
//     int32 _pad1[2],
//     irsdk_varBuf varBuf[4]      (4 × {int32 tickCount; int32 bufOffset; int32 pad[2]})
//
//   bytes 112..143 irsdk_diskSubHeader         (32 B, somente em .ibt)
//     int64 sessionStartDate, double sessionStartTime, double sessionEndTime,
//     int32 sessionLapCount, int32 sessionRecordCount
//
//   varHeaderOffset .. +numVars*144   irsdk_varHeader[]
//     int32 type, offset, count, bool countAsTime + 3 pad,
//     char name[32], desc[64], unit[32]
//
//   sessionInfoOffset .. +sessionInfoLen   string YAML (UTF-8)
//
//   varBuf[0].bufOffset .. EOF         registros de telemetria
//     cada registro = bufLen bytes; total = sessionRecordCount registros
//     (ou floor((fileSize - bufOffset) / bufLen) se o subheader estiver vazio)
//
// O parser roda em qualquer SO sobre um arquivo já existente; na prática só
// Windows tem o iRacing instalado para gerar `.ibt`, mas mantemos cross-OS para
// que testes/CI consigam exercitar o pipeline sem dependência de SO.
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_SIZE = 112
const DISK_SUBHEADER_SIZE = 32
const VAR_HEADER_SIZE = 144
const MAX_NUM_VARS = 4000
const MAX_SESSION_INFO_LEN = 8 * 1024 * 1024
const MAX_RECORDS = 5_000_000
const MAX_BUF_LEN = 1024 * 1024
const MAX_TELEMETRY_BYTES = 512 * 1024 * 1024

const TYPE_CHAR = 0
const TYPE_BOOL = 1
const TYPE_INT = 2
const TYPE_BITFIELD = 3
const TYPE_FLOAT = 4
const TYPE_DOUBLE = 5

const CHANNEL_NAMES = [
  'SessionTime',
  'Lap',
  'LapDistPct',
  'Speed',
  'Throttle',
  'Brake',
  'SteeringWheelAngle',
  'RPM',
  'Gear',
  'LapCurrentLapTime',
  'LapLastLapTime',
  'LapBestLapTime'
] as const

type ChannelName = (typeof CHANNEL_NAMES)[number]

interface IbtVarHeader {
  name: string
  type: number
  offset: number
  count: number
}

interface IbtHeader {
  ver: number
  status: number
  tickRate: number
  sessionInfoUpdate: number
  sessionInfoLen: number
  sessionInfoOffset: number
  numVars: number
  varHeaderOffset: number
  numBuf: number
  bufLen: number
  varBufOffsets: number[]
}

interface IbtDiskSubHeader {
  sessionStartDate: bigint
  sessionStartTime: number
  sessionEndTime: number
  sessionLapCount: number
  sessionRecordCount: number
}

export interface IbtLapMeta {
  lapIndex: number
  lapNumber?: number
  startedTick: number
  endedTick: number
  startedAtSec?: number
  endedAtSec?: number
  durationSec?: number
  sampleCount: number
  complete: boolean
}

export interface IbtTickSample {
  tick: number
  sessionTimeSec?: number
  lap?: number
  lapDistPct: number
  speedKmh: number
  throttle: number
  brake: number
  rpm?: number
  gear?: number
  steerAngleRad?: number
  currentLapTimeSec?: number
}

export interface IbtSummary {
  path: string
  fileName: string
  sizeBytes: number
  modifiedAt: number
  tickRate: number
  numVars: number
  recordCount: number
  durationSec?: number
  trackName?: string
  trackShortName?: string
  carName?: string
  sessionType?: string
  laps: IbtLapMeta[]
}

export interface IbtLapData extends IbtSummary {
  lap: IbtLapMeta
  samples: IbtTickSample[]
}

interface Preamble {
  header: IbtHeader
  diskSub: IbtDiskSubHeader | null
  varHeaders: IbtVarHeader[]
  channels: Partial<Record<ChannelName, IbtVarHeader>>
  sessionYaml: string
  sessionInfo: any
  dataOffset: number
  recordCount: number
  fileSize: number
}

function loadYamlParser(): ((text: string) => any) | null {
  try {
    const yaml = require('yaml')
    return typeof yaml?.parse === 'function' ? yaml.parse.bind(yaml) : null
  } catch {
    return null
  }
}

const yamlParse = loadYamlParser()

async function readExact(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0)
  const buf = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await fh.read(buf, offset, length - offset, position + offset)
    if (bytesRead <= 0) break
    offset += bytesRead
  }
  if (offset < length) {
    throw new Error(`Read truncated at offset ${position} (wanted ${length}, got ${offset})`)
  }
  return buf
}

function readCString(buf: Buffer, offset: number, max: number): string {
  let end = offset
  const limit = Math.min(buf.length, offset + max)
  while (end < limit && buf[end] !== 0) end += 1
  return buf.toString('utf8', offset, end).replace(/\0.*$/, '').trim()
}

function readHeader(buf: Buffer): IbtHeader {
  if (buf.length < HEADER_SIZE) throw new Error('IBT header too small')
  const ver = buf.readInt32LE(0)
  const status = buf.readInt32LE(4)
  const tickRate = buf.readInt32LE(8)
  const sessionInfoUpdate = buf.readInt32LE(12)
  const sessionInfoLen = buf.readInt32LE(16)
  const sessionInfoOffset = buf.readInt32LE(20)
  const numVars = buf.readInt32LE(24)
  const varHeaderOffset = buf.readInt32LE(28)
  const numBuf = buf.readInt32LE(32)
  const bufLen = buf.readInt32LE(36)
  const varBufOffsets: number[] = []
  // varBuf[4] começa em 48 (após pad1[2]); cada entrada tem 16 bytes
  // {int32 tickCount; int32 bufOffset; int32 pad[2]}; só nos importa bufOffset
  for (let i = 0; i < 4; i += 1) {
    const base = 48 + i * 16
    varBufOffsets.push(buf.readInt32LE(base + 4))
  }
  return {
    ver,
    status,
    tickRate,
    sessionInfoUpdate,
    sessionInfoLen,
    sessionInfoOffset,
    numVars,
    varHeaderOffset,
    numBuf,
    bufLen,
    varBufOffsets
  }
}

function readDiskSubHeader(buf: Buffer): IbtDiskSubHeader {
  if (buf.length < DISK_SUBHEADER_SIZE) throw new Error('IBT disk sub-header too small')
  return {
    sessionStartDate: buf.readBigInt64LE(0),
    sessionStartTime: buf.readDoubleLE(8),
    sessionEndTime: buf.readDoubleLE(16),
    sessionLapCount: buf.readInt32LE(24),
    sessionRecordCount: buf.readInt32LE(28)
  }
}

function parseVarHeaders(buf: Buffer, numVars: number): IbtVarHeader[] {
  const headers: IbtVarHeader[] = []
  const count = Math.max(0, Math.min(numVars, MAX_NUM_VARS, Math.floor(buf.length / VAR_HEADER_SIZE)))
  for (let i = 0; i < count; i += 1) {
    const base = i * VAR_HEADER_SIZE
    headers.push({
      type: buf.readInt32LE(base + 0),
      offset: buf.readInt32LE(base + 4),
      count: buf.readInt32LE(base + 8),
      name: readCString(buf, base + 16, 32)
    })
  }
  return headers
}

function indexChannels(varHeaders: IbtVarHeader[]): Partial<Record<ChannelName, IbtVarHeader>> {
  const idx: Partial<Record<ChannelName, IbtVarHeader>> = {}
  const wanted = new Set<string>(CHANNEL_NAMES)
  for (const header of varHeaders) {
    if (wanted.has(header.name)) idx[header.name as ChannelName] = header
  }
  return idx
}

function readChannelValue(buf: Buffer, header: IbtVarHeader): number | undefined {
  if (!header) return undefined
  const pos = header.offset
  if (pos < 0 || pos >= buf.length) return undefined
  try {
    switch (header.type) {
      case TYPE_CHAR:
        return buf[pos]
      case TYPE_BOOL:
        return buf[pos] ? 1 : 0
      case TYPE_INT:
      case TYPE_BITFIELD:
        return pos + 4 <= buf.length ? buf.readInt32LE(pos) : undefined
      case TYPE_FLOAT:
        return pos + 4 <= buf.length ? buf.readFloatLE(pos) : undefined
      case TYPE_DOUBLE:
        return pos + 8 <= buf.length ? buf.readDoubleLE(pos) : undefined
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function pickDataOffset(header: IbtHeader): number {
  // Para .ibt usamos a primeira entrada de varBuf não-zero. Quando o iRacing
  // grava só um buffer, varBuf[0].bufOffset aponta direto para o início dos
  // registros de telemetria.
  for (let i = 0; i < Math.max(1, Math.min(header.numBuf, header.varBufOffsets.length)); i += 1) {
    const off = header.varBufOffsets[i]
    if (off && off > 0) return off
  }
  // Fallback defensivo: logo após o YAML.
  return header.sessionInfoOffset + Math.max(0, header.sessionInfoLen)
}

function extractTrackName(sessionInfo: any): string | undefined {
  const w = sessionInfo?.WeekendInfo
  if (!w) return undefined
  const name = typeof w.TrackDisplayName === 'string' ? w.TrackDisplayName.trim() : undefined
  if (name) return name
  return typeof w.TrackName === 'string' ? w.TrackName.trim() : undefined
}

function extractTrackShortName(sessionInfo: any): string | undefined {
  const w = sessionInfo?.WeekendInfo
  if (!w) return undefined
  const short = typeof w.TrackDisplayShortName === 'string' ? w.TrackDisplayShortName.trim() : undefined
  return short || extractTrackName(sessionInfo)
}

function extractCarName(sessionInfo: any): string | undefined {
  const drivers = sessionInfo?.DriverInfo?.Drivers
  const idx = sessionInfo?.DriverInfo?.DriverCarIdx
  if (Array.isArray(drivers) && typeof idx === 'number' && drivers[idx]) {
    const driver = drivers[idx]
    return (
      (typeof driver.CarScreenName === 'string' && driver.CarScreenName.trim()) ||
      (typeof driver.CarScreenNameShort === 'string' && driver.CarScreenNameShort.trim()) ||
      (typeof driver.CarPath === 'string' && driver.CarPath.trim()) ||
      undefined
    )
  }
  return undefined
}

function extractSessionType(sessionInfo: any): string | undefined {
  const sessions = sessionInfo?.SessionInfo?.Sessions
  if (Array.isArray(sessions) && sessions.length > 0) {
    const last = sessions[sessions.length - 1]
    return typeof last?.SessionType === 'string' ? last.SessionType.trim() : undefined
  }
  return undefined
}

async function readPreamble(fh: FileHandle, path: string): Promise<Preamble> {
  const stats = await fh.stat()
  const fileSize = stats.size
  if (fileSize < HEADER_SIZE + DISK_SUBHEADER_SIZE) {
    throw new Error(`IBT file too small (${fileSize} B): ${path}`)
  }

  const headerBuf = await readExact(fh, HEADER_SIZE, 0)
  const header = readHeader(headerBuf)
  if (header.numVars <= 0 || header.numVars > MAX_NUM_VARS) {
    throw new Error(`IBT numVars out of bounds (${header.numVars})`)
  }
  if (header.bufLen <= 0 || header.bufLen > MAX_BUF_LEN) {
    throw new Error(`IBT bufLen out of bounds (${header.bufLen})`)
  }
  if (header.varHeaderOffset < HEADER_SIZE || header.varHeaderOffset > fileSize) {
    throw new Error(`IBT varHeaderOffset out of bounds (${header.varHeaderOffset})`)
  }
  if (header.sessionInfoLen < 0 || header.sessionInfoLen > MAX_SESSION_INFO_LEN) {
    throw new Error(`IBT sessionInfoLen out of bounds (${header.sessionInfoLen})`)
  }

  let diskSub: IbtDiskSubHeader | null = null
  try {
    const diskBuf = await readExact(fh, DISK_SUBHEADER_SIZE, HEADER_SIZE)
    diskSub = readDiskSubHeader(diskBuf)
  } catch {
    diskSub = null
  }

  const varHeadersLen = header.numVars * VAR_HEADER_SIZE
  if (header.varHeaderOffset + varHeadersLen > fileSize) {
    throw new Error(`IBT varHeader block exceeds file size`)
  }
  const varHeadersBuf = await readExact(fh, varHeadersLen, header.varHeaderOffset)
  const varHeaders = parseVarHeaders(varHeadersBuf, header.numVars)
  const channels = indexChannels(varHeaders)

  let sessionYaml = ''
  let sessionInfo: any = null
  if (header.sessionInfoLen > 0 && header.sessionInfoOffset > 0 && header.sessionInfoOffset + header.sessionInfoLen <= fileSize) {
    const yamlBuf = await readExact(fh, header.sessionInfoLen, header.sessionInfoOffset)
    sessionYaml = yamlBuf.toString('utf8').replace(/\0+$/, '')
    if (yamlParse) {
      try {
        sessionInfo = yamlParse(sessionYaml)
      } catch {
        sessionInfo = null
      }
    }
  }

  const dataOffset = pickDataOffset(header)
  if (dataOffset <= 0 || dataOffset > fileSize) {
    throw new Error(`IBT data offset out of bounds (${dataOffset})`)
  }
  const availableBytes = fileSize - dataOffset
  if (availableBytes < 0) throw new Error(`IBT file size smaller than data offset`)
  const inferredRecords = Math.floor(availableBytes / header.bufLen)
  const declaredRecords = diskSub?.sessionRecordCount ?? 0
  let recordCount: number
  if (declaredRecords > 0 && declaredRecords <= inferredRecords && declaredRecords <= MAX_RECORDS) {
    recordCount = declaredRecords
  } else {
    recordCount = Math.min(inferredRecords, MAX_RECORDS)
  }

  return {
    header,
    diskSub,
    varHeaders,
    channels,
    sessionYaml,
    sessionInfo,
    dataOffset,
    recordCount,
    fileSize
  }
}

async function readTelemetryBuffer(fh: FileHandle, preamble: Preamble): Promise<Buffer> {
  const totalBytes = preamble.recordCount * preamble.header.bufLen
  if (totalBytes < 0) return Buffer.alloc(0)
  if (totalBytes > MAX_TELEMETRY_BYTES) {
    throw new Error(`IBT telemetry block too large (${totalBytes} B > ${MAX_TELEMETRY_BYTES} B)`)
  }
  if (totalBytes === 0) return Buffer.alloc(0)
  return readExact(fh, totalBytes, preamble.dataOffset)
}

function buildSample(preamble: Preamble, recordBuf: Buffer, tickIndex: number): IbtTickSample | null {
  const ch = preamble.channels
  const lapDistPctRaw = readChannelValue(recordBuf, ch.LapDistPct as IbtVarHeader)
  if (lapDistPctRaw === undefined) return null
  const lapDistPct = Math.max(0, Math.min(1, lapDistPctRaw))
  const speedMs = finite(readChannelValue(recordBuf, ch.Speed as IbtVarHeader)) ?? 0
  const throttle = Math.max(0, Math.min(1, finite(readChannelValue(recordBuf, ch.Throttle as IbtVarHeader)) ?? 0))
  const brake = Math.max(0, Math.min(1, finite(readChannelValue(recordBuf, ch.Brake as IbtVarHeader)) ?? 0))
  return {
    tick: tickIndex,
    sessionTimeSec: finite(readChannelValue(recordBuf, ch.SessionTime as IbtVarHeader)),
    lap: finite(readChannelValue(recordBuf, ch.Lap as IbtVarHeader)),
    lapDistPct,
    speedKmh: speedMs * 3.6,
    throttle,
    brake,
    rpm: finite(readChannelValue(recordBuf, ch.RPM as IbtVarHeader)),
    gear: finite(readChannelValue(recordBuf, ch.Gear as IbtVarHeader)),
    steerAngleRad: finite(readChannelValue(recordBuf, ch.SteeringWheelAngle as IbtVarHeader)),
    currentLapTimeSec: finite(readChannelValue(recordBuf, ch.LapCurrentLapTime as IbtVarHeader))
  }
}

function detectLaps(samples: Array<{ tick: number; lap?: number; lapDistPct: number; sessionTimeSec?: number }>): IbtLapMeta[] {
  const laps: IbtLapMeta[] = []
  if (samples.length === 0) return laps

  let currentLapIdx = -1
  let lastLap: IbtLapMeta | null = null
  let lastLapStartedAtBoundary = false
  let prevLapDist: number | null = null

  const finishLap = (lap: IbtLapMeta, tick: number, sessionTimeSec: number | undefined, complete: boolean): void => {
    lap.endedTick = tick
    lap.endedAtSec = sessionTimeSec
    lap.complete = complete
    if (lap.startedAtSec !== undefined && sessionTimeSec !== undefined) {
      lap.durationSec = Math.max(0, sessionTimeSec - lap.startedAtSec)
    }
  }

  for (const s of samples) {
    const lapNum = s.lap
    const wrapped = prevLapDist !== null && prevLapDist > 0.82 && s.lapDistPct < 0.18
    const lapNumberChanged =
      lastLap && lapNum !== undefined && lastLap.lapNumber !== undefined && lapNum > lastLap.lapNumber

    if (!lastLap || wrapped || lapNumberChanged) {
      if (lastLap) finishLap(lastLap, s.tick - 1, s.sessionTimeSec, lastLapStartedAtBoundary)
      currentLapIdx += 1
      lastLapStartedAtBoundary = wrapped || Boolean(lapNumberChanged) || (!lastLap && s.lapDistPct < 0.18)
      const meta: IbtLapMeta = {
        lapIndex: currentLapIdx,
        lapNumber: lapNum,
        startedTick: s.tick,
        endedTick: s.tick,
        startedAtSec: s.sessionTimeSec,
        sampleCount: 0,
        complete: false
      }
      laps.push(meta)
      lastLap = meta
    }

    if (lastLap) {
      lastLap.endedTick = s.tick
      lastLap.sampleCount += 1
    }
    prevLapDist = s.lapDistPct
  }

  if (lastLap) {
    const last = samples[samples.length - 1]
    finishLap(lastLap, last.tick, last.sessionTimeSec, false)
  }
  return laps
}

function ensureLapDuration(laps: IbtLapMeta[]): IbtLapMeta[] {
  return laps.map((lap) => {
    if (lap.durationSec !== undefined) return lap
    if (lap.startedAtSec !== undefined && lap.endedAtSec !== undefined) {
      return { ...lap, durationSec: Math.max(0, lap.endedAtSec - lap.startedAtSec) }
    }
    return lap
  })
}

function summarize(preamble: Preamble, laps: IbtLapMeta[], path: string, fileSize: number, modifiedAt: number): IbtSummary {
  return {
    path,
    fileName: basename(path),
    sizeBytes: fileSize,
    modifiedAt,
    tickRate: preamble.header.tickRate,
    numVars: preamble.header.numVars,
    recordCount: preamble.recordCount,
    durationSec: preamble.header.tickRate > 0 ? preamble.recordCount / preamble.header.tickRate : undefined,
    trackName: extractTrackName(preamble.sessionInfo),
    trackShortName: extractTrackShortName(preamble.sessionInfo),
    carName: extractCarName(preamble.sessionInfo),
    sessionType: extractSessionType(preamble.sessionInfo),
    laps
  }
}

export async function parseIbtSummary(path: string): Promise<IbtSummary> {
  const fileStats = await stat(path)
  const fh = await open(path, 'r')
  try {
    const preamble = await readPreamble(fh, path)
    const data = await readTelemetryBuffer(fh, preamble)
    const bufLen = preamble.header.bufLen
    const lite: Array<{ tick: number; lap?: number; lapDistPct: number; sessionTimeSec?: number }> = []
    const ch = preamble.channels
    for (let tick = 0; tick < preamble.recordCount; tick += 1) {
      const rec = data.subarray(tick * bufLen, (tick + 1) * bufLen)
      const lapDistPctRaw = readChannelValue(rec, ch.LapDistPct as IbtVarHeader)
      if (lapDistPctRaw === undefined) continue
      lite.push({
        tick,
        lap: finite(readChannelValue(rec, ch.Lap as IbtVarHeader)),
        lapDistPct: Math.max(0, Math.min(1, lapDistPctRaw)),
        sessionTimeSec: finite(readChannelValue(rec, ch.SessionTime as IbtVarHeader))
      })
    }
    const laps = ensureLapDuration(detectLaps(lite))
    return summarize(preamble, laps, path, fileStats.size, fileStats.mtimeMs)
  } finally {
    await fh.close()
  }
}

export async function parseIbtLap(path: string, lapIndex: number, opts?: { strideTicks?: number }): Promise<IbtLapData> {
  const stride = Math.max(1, Math.floor(opts?.strideTicks ?? 1))
  const fileStats = await stat(path)
  const fh = await open(path, 'r')
  try {
    const preamble = await readPreamble(fh, path)
    const data = await readTelemetryBuffer(fh, preamble)
    const bufLen = preamble.header.bufLen
    const samples: IbtTickSample[] = []
    for (let tick = 0; tick < preamble.recordCount; tick += 1) {
      const rec = data.subarray(tick * bufLen, (tick + 1) * bufLen)
      const sample = buildSample(preamble, rec, tick)
      if (sample) samples.push(sample)
    }
    const laps = ensureLapDuration(detectLaps(samples))
    const meta = laps[lapIndex]
    if (!meta) throw new Error(`Lap index ${lapIndex} not found in ${path}`)
    let lapSamples = samples.filter((s) => s.tick >= meta.startedTick && s.tick <= meta.endedTick)
    if (stride > 1) {
      lapSamples = lapSamples.filter((_, idx) => idx % stride === 0)
    }
    const base = summarize(preamble, laps, path, fileStats.size, fileStats.mtimeMs)
    return { ...base, lap: meta, samples: lapSamples }
  } finally {
    await fh.close()
  }
}
