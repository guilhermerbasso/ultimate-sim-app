import { createRequire } from 'node:module'
import type { IRacingMmfDiagnostics } from '../../shared/telemetry'
import {
  IRSDK_VAR_HEADER_SIZE,
  MAX_SESSION_INFO_LEN,
  boundedVarCount,
  decodeVarValues,
  isRangeWithin,
  plausibleMapSize,
  readConsistentVarFrame,
  validateHeaderBounds,
  type IrsdkFrameFailure,
  type IrsdkFrameSource,
  type IrsdkHeaderLike,
  type IrsdkNamedVarHeader
} from './irsdk-frame'

const require = createRequire(import.meta.url)

const IRSDK_MEM_MAP_FILE = 'Local\\IRSDKMemMapFileName'
const IRSDK_DATA_VALID_EVENT = 'Local\\IRSDKDataValidEvent'
const IRSDK_BROADCAST_MESSAGE = 'IRSDK_BROADCASTMSG'
const HWND_BROADCAST = 0xffff
const FILE_MAP_READ = 0x0004
const SYNCHRONIZE = 0x00100000

// irsdk_StatusField bit 0 (irsdk_stConnected): set while the sim is running and the
// memory map holds valid data. This — not the auto-reset data-valid event — is the
// canonical "connected" signal used by every irsdk client (pyirsdk/node-irsdk/SimHub).
const IRSDK_ST_CONNECTED = 1

// irsdk_VarType values live in ./irsdk-frame (IRSDK_VAR_TYPES) alongside the decoder.

// iRacing broadcast command enum (irsdk_BroadcastMsg).
export const IRSDK_BROADCAST = {
  camSwitchPos: 0,
  camSwitchNum: 1,
  camSetState: 2,
  replaySetPlaySpeed: 3,
  replaySetPlayPosition: 4,
  replaySearch: 5,
  replaySetState: 6,
  reloadTextures: 7,
  chatCommand: 8,
  pitCommand: 9,
  telemetryCommand: 10,
  ffbCommand: 11,
  replaySearchSessionTime: 12,
  videoCapture: 13
} as const

// iRacing pit command enum (irsdk_PitCommandMode). The full vocabulary from
// irsdk_defines.h — the trailing five (clearWS..tc) were previously missing.
export const IRSDK_PIT_COMMAND = {
  clear: 0,
  windshield: 1,
  fuel: 2,
  lf: 3,
  rf: 4,
  lr: 5,
  rr: 6,
  clearTires: 7,
  fastRepair: 8,
  clearWS: 9,
  clearFR: 10,
  clearFuel: 11,
  tc: 12
} as const

// iRacing chat command enum (irsdk_ChatCommandMode). Broadcast supports chat macros,
// begin/reply/cancel; it does not carry arbitrary free-text chat strings.
export const IRSDK_CHAT_COMMAND = {
  macro: 0,
  beginChat: 1,
  reply: 2,
  cancel: 3
} as const

// Common replay state enum values used by the SDK broadcast message.
export const IRSDK_REPLAY_STATE = {
  eraseTape: 0,
  play: 1,
  pause: 2,
  fastForward: 3,
  rewind: 4
} as const

// iRacing replay-search enum (irsdk_RpySrchMode) — passed as var1 of the
// replaySearch broadcast to jump the replay tape to a marker.
export const IRSDK_REPLAY_SEARCH = {
  toStart: 0,
  toEnd: 1,
  prevSession: 2,
  nextSession: 3,
  prevLap: 4,
  nextLap: 5,
  prevFrame: 6,
  nextFrame: 7,
  prevIncident: 8,
  nextIncident: 9
} as const

// iRacing camera "focus at" pseudo-targets (irsdk_csMode) — passed as var1
// (carIdx slot) of camSwitchPos/camSwitchNum to follow leader/incident/exiting.
export const IRSDK_CAM_FOCUS = {
  incident: -3,
  leader: -2,
  exiting: -1,
  driver: 0
} as const

type NativeLibraries = {
  koffi: any
  kernel32: any
  user32: any
  OpenFileMappingW: (...args: any[]) => any
  MapViewOfFile: (...args: any[]) => any
  UnmapViewOfFile: (...args: any[]) => any
  CloseHandle: (...args: any[]) => any
  OpenEventW: (...args: any[]) => any
  WaitForSingleObject: (...args: any[]) => number
  VirtualQuery: ((...args: any[]) => number) | null
  memoryBasicInformation: any
  RegisterWindowMessageW: (...args: any[]) => number
  SendNotifyMessageW: (...args: any[]) => boolean
  headerStruct: any
  varBufStruct: any
  varHeaderStruct: any
}

// Bounds/limit constants live in ./irsdk-frame so the pure algorithm and the native
// reader agree on a single contract (MAX_NUM_VARS, MAX_SESSION_INFO_LEN, buffer sizes).

type IRSDKHeader = {
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
  curBufTickCount: number
  curBuf: number
  varBuf: Array<{ tickCount: number; bufOffset: number }>
}

export type IRacingFrameInfo = {
  /** irsdk varBuf slot the sample was copied from. */
  bufferIndex: number
  /** Tick count of that slot, identical before and after the copy (never torn). */
  tickCount: number
  /** How many copy attempts were needed before the tick count held still. */
  attempts: number
  /** Wall-clock time the consistent copy was taken. */
  readAt: number
}

export type IRacingReadResult = {
  values: Record<string, unknown>
  sessionInfo: any
  sessionInfoYaml: string
  header: IRSDKHeader
  frame: IRacingFrameInfo
}

/**
 * Test seam. Supplying a frame source (and optionally the var-header/session-info
 * readers) drives the real read() algorithm against a synthetic memory map, so the
 * torn-frame and bounds behaviour is provable without koffi or a running simulator.
 */
export type IRacingMemoryMapOptions = {
  frameSource?: IrsdkFrameSource
  readVarHeaders?: (header: IrsdkHeaderLike) => IrsdkNamedVarHeader[]
  readSessionInfoYaml?: (header: IrsdkHeaderLike) => string
}

export type BroadcastResult = {
  ok: boolean
  supported: boolean
  message?: string
}

function loadKoffi(): any | null {
  try {
    return require('koffi')
  } catch {
    return null
  }
}

function koffiAvailable(): boolean {
  return loadKoffi() != null
}

function loadYamlParser(): ((text: string) => any) | null {
  try {
    const yaml = require('yaml')
    return typeof yaml?.parse === 'function' ? yaml.parse.bind(yaml) : null
  } catch {
    return null
  }
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\0.*$/, '').trim()
  if (Array.isArray(value)) {
    return value.map((char) => typeof char === 'number' ? String.fromCharCode(char) : '').join('').replace(/\0.*$/, '').trim()
  }
  return String(value ?? '').replace(/\0.*$/, '').trim()
}

function makeLong(low: number, high = 0): number {
  return (low & 0xffff) | ((high & 0xffff) << 16)
}

// koffi.struct() registers type names globally per process and throws on a duplicate
// name, so cache the libraries module-wide and register the structs exactly once. The
// provider, the broadcast helper, and the diagnostics probe all share this single load.
let cachedNative: NativeLibraries | null = null
let nativeLoadAttempted = false

function loadNativeLibraries(): NativeLibraries | null {
  if (nativeLoadAttempted) return cachedNative
  nativeLoadAttempted = true
  if (process.platform !== 'win32') return null
  const koffi = loadKoffi()
  if (!koffi) return null

  try {
    const kernel32 = koffi.load('kernel32.dll')
    const user32 = koffi.load('user32.dll')
    // irsdk_varBuf is a 16-byte struct: int32 tickCount, int32 bufOffset,
    // int32 tickCountBegin, int32 pad. The trailing fields are required so the
    // four-entry varBuf[] inside irsdk_header lines up with the SDK offsets.
    const varBufStruct = koffi.struct('irsdk_varBuf', {
      tickCount: 'int32',
      bufOffset: 'int32',
      tickCountBegin: 'int32',
      _pad: koffi.array('int32', 1)
    })
    // irsdk_header in irsdk_defines.h has curBufTickCount + curBuf/pad BEFORE
    // varBuf[4]. Without those 8 bytes every varBuf entry is read from the wrong
    // offset and pickLatestBufferOffset returns garbage (most commonly 0).
    const headerStruct = koffi.struct('irsdk_header', {
      ver: 'int32',
      status: 'int32',
      tickRate: 'int32',
      sessionInfoUpdate: 'int32',
      sessionInfoLen: 'int32',
      sessionInfoOffset: 'int32',
      numVars: 'int32',
      varHeaderOffset: 'int32',
      numBuf: 'int32',
      bufLen: 'int32',
      curBufTickCount: 'int32',
      curBuf: 'uint8',
      _pad1: koffi.array('uint8', 3),
      varBuf: koffi.array(varBufStruct, 4)
    })
    const varHeaderStruct = koffi.struct('irsdk_varHeader', {
      type: 'int32',
      offset: 'int32',
      count: 'int32',
      countAsTime: 'bool',
      _pad: koffi.array('uint8', 3),
      name: 'char[32]',
      desc: 'char[64]',
      unit: 'char[32]'
    })
    // MEMORY_BASIC_INFORMATION (_WIN64 layout: PartitionId sits between
    // AllocationProtect and RegionSize). Used only to learn how large the mapped view
    // is so no read can walk past it; a implausible result is discarded, never trusted.
    let memoryBasicInformation: any = null
    let VirtualQuery: ((...args: any[]) => number) | null = null
    try {
      memoryBasicInformation = koffi.struct('MEMORY_BASIC_INFORMATION', {
        BaseAddress: 'void*',
        AllocationBase: 'void*',
        AllocationProtect: 'uint32',
        PartitionId: 'uint16',
        _pad0: koffi.array('uint8', 2),
        RegionSize: 'size_t',
        State: 'uint32',
        Protect: 'uint32',
        Type: 'uint32',
        _pad1: koffi.array('uint8', 4)
      })
      VirtualQuery = kernel32.func('VirtualQuery', 'size_t', ['void*', koffi.out(koffi.pointer(memoryBasicInformation)), 'size_t'])
    } catch {
      memoryBasicInformation = null
      VirtualQuery = null
    }

    cachedNative = {
      koffi,
      kernel32,
      user32,
      OpenFileMappingW: kernel32.func('OpenFileMappingW', 'void*', ['uint32', 'bool', 'str16']),
      MapViewOfFile: kernel32.func('MapViewOfFile', 'void*', ['void*', 'uint32', 'uint32', 'uint32', 'size_t']),
      UnmapViewOfFile: kernel32.func('UnmapViewOfFile', 'bool', ['void*']),
      CloseHandle: kernel32.func('CloseHandle', 'bool', ['void*']),
      OpenEventW: kernel32.func('OpenEventW', 'void*', ['uint32', 'bool', 'str16']),
      WaitForSingleObject: kernel32.func('WaitForSingleObject', 'uint32', ['void*', 'uint32']),
      VirtualQuery,
      memoryBasicInformation,
      RegisterWindowMessageW: user32.func('RegisterWindowMessageW', 'uint32', ['str16']),
      SendNotifyMessageW: user32.func('SendNotifyMessageW', 'bool', ['void*', 'uint32', 'uint64', 'int64']),
      headerStruct,
      varBufStruct,
      varHeaderStruct
    }
    return cachedNative
  } catch {
    return null
  }
}

export class IRacingMemoryMap {
  private native: NativeLibraries | null = null
  private fileHandle: any | null = null
  private dataEventHandle: any | null = null
  private viewPointer: any | null = null
  private yamlParser: ((text: string) => any) | null = null
  private lastSessionInfoUpdate = -1
  private lastSessionInfo: any = null
  private lastSessionInfoYaml = ''
  private lastSessionInfoYamlUpdate = -1
  private mappedSize: number | null = null
  private varHeaderCacheKey = ''
  private varHeaderCache: IrsdkNamedVarHeader[] = []
  private lastFrameFailure: IrsdkFrameFailure | null = null
  private tornFrameCount = 0
  private readonly options: IRacingMemoryMapOptions

  constructor(options: IRacingMemoryMapOptions = {}) {
    this.options = options
  }

  start(): void {
    if (this.options.frameSource) return
    if (this.viewPointer) return
    this.native = loadNativeLibraries()
    if (!this.native) return
    this.yamlParser = loadYamlParser()

    try {
      this.fileHandle = this.native.OpenFileMappingW(FILE_MAP_READ, false, IRSDK_MEM_MAP_FILE)
      if (!this.fileHandle) return
      this.viewPointer = this.native.MapViewOfFile(this.fileHandle, FILE_MAP_READ, 0, 0, 0)
      if (!this.viewPointer) {
        this.closeHandle(this.fileHandle)
        this.fileHandle = null
        return
      }
      this.mappedSize = this.queryMappedSize()
      this.dataEventHandle = this.native.OpenEventW(SYNCHRONIZE, false, IRSDK_DATA_VALID_EVENT)
    } catch {
      this.stop()
    }
  }

  stop(): void {
    try {
      if (this.viewPointer) this.native?.UnmapViewOfFile(this.viewPointer)
      this.closeHandle(this.dataEventHandle)
      this.closeHandle(this.fileHandle)
    } catch {
      // Native cleanup is best-effort; do not fail Electron shutdown.
    }
    this.viewPointer = null
    this.fileHandle = null
    this.dataEventHandle = null
    this.native = null
    this.mappedSize = null
    this.varHeaderCacheKey = ''
    this.varHeaderCache = []
    this.lastFrameFailure = null
    this.tornFrameCount = 0
    this.lastSessionInfoUpdate = -1
    this.lastSessionInfo = null
    this.lastSessionInfoYaml = ''
    this.lastSessionInfoYamlUpdate = -1
  }

  isOpen(): boolean {
    if (this.options.frameSource) return true
    return Boolean(this.native && this.viewPointer)
  }

  isConnected(): boolean {
    if (!this.isOpen()) return false
    const header = this.readHeader()
    if (!header) return false
    // Connection is driven by the header status bit, never by the data-valid event:
    // a 0 ms wait on that auto-reset event almost always times out, which is exactly
    // why telemetry never appeared even with iRacing running and on track.
    return (header.status & IRSDK_ST_CONNECTED) !== 0 && header.numVars > 0 && header.bufLen > 0
  }

  /** Diagnostic counters for the last read cycle — surfaced by diagnose(). */
  frameHealth(): { lastFailure: IrsdkFrameFailure | null; tornFrames: number; mappedSize: number | null } {
    return { lastFailure: this.lastFrameFailure, tornFrames: this.tornFrameCount, mappedSize: this.mappedSize }
  }

  read(): IRacingReadResult | null {
    if (!this.isOpen()) return null

    try {
      const outcome = readConsistentVarFrame(this.frameSource())
      if (!outcome.ok) {
        this.lastFrameFailure = outcome.reason
        if (outcome.reason === 'torn') this.tornFrameCount += 1
        // A frame that could not be copied consistently is NEVER published: half of it
        // would come from tick N and half from tick N+1.
        return null
      }
      this.lastFrameFailure = null
      const header = outcome.frame.header as IRSDKHeader
      if ((header.status & IRSDK_ST_CONNECTED) === 0) return null

      const varHeaders = this.varHeadersFor(header)
      const values = decodeVarValues(outcome.frame.buffer, varHeaders)
      const sessionInfoYaml = this.readSessionInfoYaml(header)
      const sessionInfo = this.parseSessionInfo(header, sessionInfoYaml)
      return {
        values,
        sessionInfo,
        sessionInfoYaml,
        header,
        frame: {
          bufferIndex: outcome.frame.bufferIndex,
          tickCount: outcome.frame.tickCount,
          attempts: outcome.frame.attempts,
          readAt: Date.now()
        }
      }
    } catch {
      return null
    }
  }

  // Self-contained probe of the whole native pipeline. Reports where the read stops
  // and a few sample vars, so the user can run it on track and share the result.
  diagnose(): IRacingMmfDiagnostics {
    const notes: string[] = []
    const platform = process.platform
    const koffiLoaded = koffiAvailable()
    const nativeLoaded = this.native != null
    const fileMappingOpened = this.fileHandle != null
    const viewMapped = this.viewPointer != null
    const dataEventOpened = this.dataEventHandle != null

    if (platform !== 'win32') {
      notes.push('Non-Windows platform: the native iRacing bridge only works on Windows.')
    } else if (!koffiLoaded) {
      notes.push('koffi could not be loaded (native module missing or broken in the package).')
    } else if (!nativeLoaded) {
      notes.push('kernel32/user32 could not be loaded through koffi.')
    } else if (!fileMappingOpened) {
      notes.push('OpenFileMapping failed: iRacing is not running (memory map missing).')
    } else if (!viewMapped) {
      notes.push('MapViewOfFile failed: could not map iRacing memory.')
    }

    let headerRead = false
    let status: number | null = null
    let numVars: number | null = null
    let bufLen: number | null = null
    let numBuf: number | null = null
    let tickRate: number | null = null
    const header = viewMapped ? this.readHeader() : null
    if (header) {
      headerRead = true
      status = header.status
      numVars = header.numVars
      bufLen = header.bufLen
      numBuf = header.numBuf
      tickRate = header.tickRate
    } else if (viewMapped) {
      notes.push('Failed to decode the iRacing header (possible struct layout error).')
    }

    const statusConnected = status != null && (status & IRSDK_ST_CONNECTED) !== 0
    if (headerRead && !statusConnected) {
      notes.push('iRacing is open but not connected: enter the session (in car/on track) for valid data.')
    }

    let valuesDecoded: number | null = null
    const sampleVars: Record<string, unknown> = {}
    if (statusConnected) {
      const read = this.read()
      if (read) {
        valuesDecoded = Object.keys(read.values).length
        for (const key of ['RPM', 'Speed', 'Gear', 'SessionNum', 'SessionTime', 'IsOnTrack', 'PlayerCarIdx', 'Lap']) {
          if (key in read.values) sampleVars[key] = read.values[key]
        }
        if (valuesDecoded === 0) {
          notes.push('No variables decoded despite being connected — likely struct layout error.')
        } else {
          notes.push(`OK: iRacing connected and variables decoded successfully (buffer ${read.frame.bufferIndex}, tick ${read.frame.tickCount}, ${read.frame.attempts} attempt(s)).`)
        }
      } else {
        const health = this.frameHealth()
        notes.push(`read() returned null despite the connected status (last frame failure: ${health.lastFailure ?? 'unknown'}).`)
      }
    }

    const health = this.frameHealth()
    if (health.tornFrames > 0) {
      notes.push(`${health.tornFrames} torn frame(s) were rejected instead of being published.`)
    }
    if (health.mappedSize === null && viewMapped) {
      notes.push('Mapped view size could not be determined; reads fall back to header-internal bounds only.')
    }

    return {
      platform,
      koffiLoaded,
      nativeLoaded,
      fileMappingOpened,
      viewMapped,
      dataEventOpened,
      headerRead,
      status,
      statusConnected,
      numVars,
      bufLen,
      numBuf,
      tickRate,
      valuesDecoded,
      sampleVars,
      notes
    }
  }

  private closeHandle(handle: any | null): void {
    if (handle) this.native?.CloseHandle(handle)
  }

  /** Best-effort size of the mapped view. Anything implausible is reported as unknown. */
  private queryMappedSize(): number | null {
    const native = this.native
    if (!native?.VirtualQuery || !native.memoryBasicInformation || !this.viewPointer) return null
    try {
      const info: any = {}
      const written = native.VirtualQuery(this.viewPointer, info, 48)
      if (!written) return null
      return plausibleMapSize(Number(info.RegionSize))
    } catch {
      return null
    }
  }

  /**
   * The frame source handed to the pure read algorithm. `mapSize()` self-calibrates: if
   * the VirtualQuery result would reject a header that is otherwise internally consistent,
   * the size is distrusted from then on rather than blocking valid telemetry.
   */
  private frameSource(): IrsdkFrameSource {
    if (this.options.frameSource) return this.options.frameSource
    return {
      readHeader: () => this.readHeader(),
      copyVarBuffer: (bufOffset, bufLen) => this.bytesAt(bufOffset, bufLen),
      mapSize: () => this.mappedSize
    }
  }

  private decodeAt(offset: number, type: any): any {
    const koffi = this.native?.koffi
    if (!koffi || !this.viewPointer) return null
    try {
      // koffi.decode(value, offset, type) lê `type` no byte `offset` da view mapeada.
      // (koffi.as com endereço numérico NÃO é suportado — não usar.)
      return offset === 0
        ? koffi.decode(this.viewPointer, type)
        : koffi.decode(this.viewPointer, offset, type)
    } catch {
      return null
    }
  }

  /**
   * Raw copy out of the mapped view. Refuses any range that is negative or that would
   * walk past the end of the mapping — reading unmapped memory through koffi is an
   * access violation that takes the whole main process down.
   */
  private bytesAt(offset: number, length: number): Buffer | null {
    const koffi = this.native?.koffi
    if (!koffi || length <= 0) return null
    if (!isRangeWithin(offset, length, this.mappedSize)) return null
    const byteArray = koffi.array('uint8', length)
    const raw = this.decodeAt(offset, byteArray)
    if (raw == null) return null
    if (Buffer.isBuffer(raw)) return raw
    if (raw instanceof Uint8Array) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
    if (!Array.isArray(raw)) return null
    return Buffer.from(raw as number[])
  }

  private readHeader(): IRSDKHeader | null {
    if (this.options.frameSource) return this.options.frameSource.readHeader() as IRSDKHeader | null
    const raw = this.decodeAt(0, this.native?.headerStruct)
    if (!raw) return null
    const header: IRSDKHeader = {
      ver: Number(raw.ver ?? 0),
      status: Number(raw.status ?? 0),
      tickRate: Number(raw.tickRate ?? 0),
      sessionInfoUpdate: Number(raw.sessionInfoUpdate ?? 0),
      sessionInfoLen: Number(raw.sessionInfoLen ?? 0),
      sessionInfoOffset: Number(raw.sessionInfoOffset ?? 0),
      numVars: Number(raw.numVars ?? 0),
      varHeaderOffset: Number(raw.varHeaderOffset ?? 0),
      numBuf: Number(raw.numBuf ?? 0),
      bufLen: Number(raw.bufLen ?? 0),
      curBufTickCount: Number(raw.curBufTickCount ?? 0),
      curBuf: Number(raw.curBuf ?? 0),
      varBuf: Array.from(raw.varBuf ?? []).map((buf: any) => ({ tickCount: Number(buf.tickCount ?? 0), bufOffset: Number(buf.bufOffset ?? 0) }))
    }
    // Self-calibration: a header that is internally consistent but fails only because of
    // the VirtualQuery size means the size is wrong, not the header. Distrust the size.
    if (this.mappedSize !== null && !validateHeaderBounds(header, this.mappedSize).ok && validateHeaderBounds(header, null).ok) {
      this.mappedSize = null
    }
    return header
  }

  /**
   * Var headers describe the layout of a telemetry buffer and only change when the
   * exported var set changes, so they are cached against the layout-defining fields
   * instead of being re-decoded 300+ times per frame.
   */
  private varHeadersFor(header: IRSDKHeader): IrsdkNamedVarHeader[] {
    const key = `${header.varHeaderOffset}:${header.numVars}:${header.bufLen}:${header.numBuf}`
    if (key === this.varHeaderCacheKey && this.varHeaderCache.length) return this.varHeaderCache
    const varHeaders = this.options.readVarHeaders
      ? this.options.readVarHeaders(header)
      : this.readVarHeaders(header)
    this.varHeaderCacheKey = key
    this.varHeaderCache = varHeaders
    return varHeaders
  }

  private readVarHeaders(header: IRSDKHeader): IrsdkNamedVarHeader[] {
    const varHeaders: IrsdkNamedVarHeader[] = []
    // Bound-check: the MMF can momentarily expose garbage during init/shutdown.
    const count = boundedVarCount(header.numVars)
    for (let i = 0; i < count; i += 1) {
      const offset = header.varHeaderOffset + i * IRSDK_VAR_HEADER_SIZE
      if (!isRangeWithin(offset, IRSDK_VAR_HEADER_SIZE, this.mappedSize)) break
      const raw = this.decodeAt(offset, this.native?.varHeaderStruct)
      if (!raw) continue
      const name = firstString(raw.name)
      if (!name) continue
      varHeaders.push({
        type: Number(raw.type ?? 0),
        offset: Number(raw.offset ?? 0),
        count: Number(raw.count ?? 1),
        name
      })
    }
    return varHeaders
  }

  private readSessionInfoYaml(header: IRSDKHeader): string {
    if (header.sessionInfoLen <= 0 || header.sessionInfoOffset <= 0) return this.lastSessionInfoYaml
    if (header.sessionInfoLen > MAX_SESSION_INFO_LEN) return this.lastSessionInfoYaml
    if (header.sessionInfoUpdate === this.lastSessionInfoYamlUpdate) return this.lastSessionInfoYaml
    if (this.options.readSessionInfoYaml) {
      this.lastSessionInfoYaml = this.options.readSessionInfoYaml(header)
      this.lastSessionInfoYamlUpdate = header.sessionInfoUpdate
      return this.lastSessionInfoYaml
    }
    const bytes = this.bytesAt(header.sessionInfoOffset, header.sessionInfoLen)
    if (!bytes) return this.lastSessionInfoYaml
    this.lastSessionInfoYaml = bytes.toString('utf8').replace(/\0+$/, '')
    this.lastSessionInfoYamlUpdate = header.sessionInfoUpdate
    return this.lastSessionInfoYaml
  }

  private parseSessionInfo(header: IRSDKHeader, yamlText: string): any {
    if (header.sessionInfoUpdate === this.lastSessionInfoUpdate && this.lastSessionInfo) return this.lastSessionInfo
    if (!yamlText || !this.yamlParser) return this.lastSessionInfo
    try {
      this.lastSessionInfo = this.yamlParser(yamlText)
      this.lastSessionInfoUpdate = header.sessionInfoUpdate
    } catch {
      this.lastSessionInfo = null
    }
    return this.lastSessionInfo
  }
}

export class IRacingBroadcast {
  private native: NativeLibraries | null = null
  private messageId = 0

  status(): { available: boolean; connected: boolean } {
    this.ensureNative()
    const connected = new IRacingMemoryMap()
    connected.start()
    const isConnected = connected.isConnected()
    connected.stop()
    return { available: Boolean(this.native && this.messageId), connected: isConnected }
  }

  // iRacing expects:
  //   wParam = MAKELONG(broadcastMsg, var1)
  //   lParam = var2
  // The previous implementation passed `command` as wParam and packed `(var1, var2)`
  // into lParam, which silently broadcast a never-registered msg ID.
  send(command: number, var1 = 0, var2 = 0): BroadcastResult {
    this.ensureNative()
    if (!this.native || !this.messageId) return { ok: false, supported: false, message: 'koffi/user32 broadcast is not available in this runtime.' }
    try {
      const ok = this.native.SendNotifyMessageW(HWND_BROADCAST, this.messageId, makeLong(command, var1), var2)
      return { ok: Boolean(ok), supported: true }
    } catch (error) {
      return { ok: false, supported: true, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private ensureNative(): void {
    if (this.native) return
    this.native = loadNativeLibraries()
    if (!this.native) return
    try {
      this.messageId = this.native.RegisterWindowMessageW(IRSDK_BROADCAST_MESSAGE)
    } catch {
      this.messageId = 0
    }
  }
}

export { makeLong }
