import { createRequire } from 'node:module'
import type { IRacingMmfDiagnostics } from '../../shared/telemetry'

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

const VAR_TYPES = {
  char: 0,
  bool: 1,
  int: 2,
  bitfield: 3,
  float: 4,
  double: 5
} as const

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
  RegisterWindowMessageW: (...args: any[]) => number
  SendNotifyMessageW: (...args: any[]) => boolean
  headerStruct: any
  varBufStruct: any
  varHeaderStruct: any
}

// Upper bound used to protect against corrupted/uninitialized memory map values
// before we iterate var-headers. Real iRacing exports rarely top a few hundred
// variables; 4000 keeps us well above headroom while preventing runaway loops.
const MAX_NUM_VARS = 4000
// Cap session-info YAML reads at 8 MiB. The real payload is normally <2 MiB but
// the field is a raw int32 from the MMF — guard against bogus values.
const MAX_SESSION_INFO_LEN = 8 * 1024 * 1024

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

type VarHeader = {
  type: number
  offset: number
  count: number
  countAsTime: number
  name: unknown
  desc: unknown
  unit: unknown
}

export type IRacingReadResult = {
  values: Record<string, unknown>
  sessionInfo: any
  sessionInfoYaml: string
  header: IRSDKHeader
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

  start(): void {
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
    this.lastSessionInfoUpdate = -1
    this.lastSessionInfo = null
    this.lastSessionInfoYaml = ''
    this.lastSessionInfoYamlUpdate = -1
  }

  isOpen(): boolean {
    return Boolean(this.native && this.viewPointer)
  }

  isConnected(): boolean {
    if (!this.native || !this.viewPointer) return false
    const header = this.readHeader()
    if (!header) return false
    // Connection is driven by the header status bit, never by the data-valid event:
    // a 0 ms wait on that auto-reset event almost always times out, which is exactly
    // why telemetry never appeared even with iRacing running and on track.
    return (header.status & IRSDK_ST_CONNECTED) !== 0 && header.numVars > 0 && header.bufLen > 0
  }

  read(): IRacingReadResult | null {
    if (!this.native || !this.viewPointer) return null

    try {
      const header = this.readHeader()
      if (!header) return null
      if ((header.status & IRSDK_ST_CONNECTED) === 0) return null
      if (header.numVars <= 0 || header.bufLen <= 0) return null
      const bufferOffset = this.pickLatestBufferOffset(header)
      const varHeaders = this.readVarHeaders(header)
      const values = this.readValues(varHeaders, bufferOffset)
      const sessionInfoYaml = this.readSessionInfoYaml(header)
      const sessionInfo = this.parseSessionInfo(header, sessionInfoYaml)
      return { values, sessionInfo, sessionInfoYaml, header }
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
      notes.push('Plataforma não-Windows: o bridge nativo do iRacing só funciona no Windows.')
    } else if (!koffiLoaded) {
      notes.push('koffi não pôde ser carregado (módulo nativo ausente ou quebrado no pacote).')
    } else if (!nativeLoaded) {
      notes.push('kernel32/user32 não puderam ser carregados via koffi.')
    } else if (!fileMappingOpened) {
      notes.push('OpenFileMapping falhou: o iRacing não está em execução (memory map ausente).')
    } else if (!viewMapped) {
      notes.push('MapViewOfFile falhou: não foi possível mapear a memória do iRacing.')
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
      notes.push('Falha ao decodificar o header do iRacing (possível erro de layout de struct).')
    }

    const statusConnected = status != null && (status & IRSDK_ST_CONNECTED) !== 0
    if (headerRead && !statusConnected) {
      notes.push('iRacing aberto mas status não conectado: entre na sessão (no carro/pista) para os dados ficarem válidos.')
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
          notes.push('Nenhuma variável decodificada apesar de conectado — provável erro de layout de struct.')
        } else {
          notes.push('OK: iRacing conectado e variáveis decodificadas com sucesso.')
        }
      } else {
        notes.push('read() retornou null apesar do status conectado.')
      }
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

  private bytesAt(offset: number, length: number): Buffer {
    const koffi = this.native?.koffi
    if (!koffi || length <= 0) return Buffer.alloc(0)
    const byteArray = koffi.array('uint8', length)
    const raw = this.decodeAt(offset, byteArray)
    return Buffer.from(Array.from(raw ?? []) as number[])
  }

  private readHeader(): IRSDKHeader | null {
    const raw = this.decodeAt(0, this.native?.headerStruct)
    if (!raw) return null
    return {
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
  }

  private pickLatestBufferOffset(header: IRSDKHeader): number {
    const buffers = header.varBuf.slice(0, Math.max(0, Math.min(header.numBuf, header.varBuf.length)))
    if (header.curBuf >= 0 && header.curBuf < buffers.length && buffers[header.curBuf]?.bufOffset > 0) {
      return buffers[header.curBuf].bufOffset
    }
    return buffers.reduce((best, current) => current.tickCount > best.tickCount ? current : best, buffers[0] ?? { tickCount: 0, bufOffset: 0 }).bufOffset
  }

  private readVarHeaders(header: IRSDKHeader): VarHeader[] {
    const varHeaders: VarHeader[] = []
    const varHeaderSize = 144
    // Bound-check: the MMF can momentarily expose garbage during init/shutdown.
    const count = Math.max(0, Math.min(header.numVars, MAX_NUM_VARS))
    for (let i = 0; i < count; i += 1) {
      const raw = this.decodeAt(header.varHeaderOffset + i * varHeaderSize, this.native?.varHeaderStruct)
      if (!raw) continue
      varHeaders.push({
        type: Number(raw.type ?? 0),
        offset: Number(raw.offset ?? 0),
        count: Number(raw.count ?? 1),
        countAsTime: Number(raw.countAsTime ?? 0),
        name: raw.name,
        desc: raw.desc,
        unit: raw.unit
      })
    }
    return varHeaders
  }

  private readValues(varHeaders: VarHeader[], bufferOffset: number): Record<string, unknown> {
    const values: Record<string, unknown> = {}
    for (const header of varHeaders) {
      const name = firstString(header.name)
      if (!name) continue
      values[name] = this.readVarValue(bufferOffset + header.offset, header.type, Math.max(1, header.count))
    }
    return values
  }

  private readVarValue(offset: number, type: number, count: number): unknown {
    const itemSize = type === VAR_TYPES.double ? 8 : type === VAR_TYPES.char || type === VAR_TYPES.bool ? 1 : 4
    const bytes = this.bytesAt(offset, itemSize * count)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const readOne = (index: number): unknown => {
      const pos = index * itemSize
      switch (type) {
        case VAR_TYPES.char:
          return String.fromCharCode(bytes[pos] ?? 0)
        case VAR_TYPES.bool:
          return (bytes[pos] ?? 0) !== 0
        case VAR_TYPES.int:
        case VAR_TYPES.bitfield:
          return view.getInt32(pos, true)
        case VAR_TYPES.float:
          return view.getFloat32(pos, true)
        case VAR_TYPES.double:
          return view.getFloat64(pos, true)
        default:
          return undefined
      }
    }

    if (type === VAR_TYPES.char) return bytes.toString('utf8').replace(/\0.*$/, '')
    if (count === 1) return readOne(0)
    return Array.from({ length: count }, (_, index) => readOne(index))
  }

  private readSessionInfoYaml(header: IRSDKHeader): string {
    if (header.sessionInfoLen <= 0 || header.sessionInfoOffset <= 0) return this.lastSessionInfoYaml
    if (header.sessionInfoLen > MAX_SESSION_INFO_LEN) return this.lastSessionInfoYaml
    if (header.sessionInfoUpdate === this.lastSessionInfoYamlUpdate) return this.lastSessionInfoYaml
    const bytes = this.bytesAt(header.sessionInfoOffset, header.sessionInfoLen)
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
