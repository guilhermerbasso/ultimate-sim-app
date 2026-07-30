// Pure, native-free half of the iRacing memory-map reader.
//
// The irsdk shared memory is a ring of `numBuf` telemetry buffers that the sim
// rewrites in place while we read them. Copying a buffer without re-checking the
// tick count afterwards publishes a TORN frame: the first half of the sample comes
// from tick N and the second half from tick N+1, so speed, gear, RPM and the
// per-car arrays disagree with each other. The C++ SDK (irsdk_utils.cpp) guards
// against this with a read/copy/re-read/retry loop, and that is what
// `readConsistentVarFrame` reproduces here.
//
// Everything in this file works on plain numbers/Buffers so the whole algorithm —
// buffer selection, bounds, torn-frame retry, value decoding — is unit-testable on
// any platform without koffi or a running simulator.

/** sizeof(irsdk_header): 10 int32 + curBufTickCount + curBuf/pad + varBuf[4] (16 bytes each). */
export const IRSDK_HEADER_SIZE = 112
/** sizeof(irsdk_varHeader): type/offset/count/countAsTime+pad + name[32] + desc[64] + unit[32]. */
export const IRSDK_VAR_HEADER_SIZE = 144
/** irsdk_defines.h IRSDK_MAX_BUFS. */
export const IRSDK_MAX_BUFS = 4

/**
 * Upper bound used to protect against corrupted/uninitialized memory-map values before
 * we iterate var-headers. Real iRacing exports rarely top a few hundred variables; 4000
 * keeps us well above headroom while preventing runaway loops.
 */
export const MAX_NUM_VARS = 4000
/** Cap session-info YAML reads at 8 MiB. The real payload is normally < 2 MiB. */
export const MAX_SESSION_INFO_LEN = 8 * 1024 * 1024
/** Cap a single telemetry buffer at 8 MiB; the real one is tens of kilobytes. */
export const MAX_BUF_LEN = 8 * 1024 * 1024

export const IRSDK_VAR_TYPES = {
  char: 0,
  bool: 1,
  int: 2,
  bitfield: 3,
  float: 4,
  double: 5
} as const

export type IrsdkVarBufEntry = { tickCount: number; bufOffset: number }

export type IrsdkHeaderLike = {
  sessionInfoLen: number
  sessionInfoOffset: number
  numVars: number
  varHeaderOffset: number
  numBuf: number
  bufLen: number
  curBuf: number
  varBuf: IrsdkVarBufEntry[]
}

export type IrsdkVarHeaderLike = {
  type: number
  offset: number
  count: number
}

/** Minimum plausible mapped-view size; anything smaller is treated as "unknown". */
export const MIN_TRUSTED_MAP_SIZE = 64 * 1024
/** Maximum plausible mapped-view size; anything larger is treated as "unknown". */
export const MAX_TRUSTED_MAP_SIZE = 1024 * 1024 * 1024

/** Accept a VirtualQuery region size only when it can plausibly be the irsdk mapping. */
export function plausibleMapSize(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const size = Math.trunc(value)
  if (size < MIN_TRUSTED_MAP_SIZE || size > MAX_TRUSTED_MAP_SIZE) return null
  return size
}

export type IrsdkVarBufSelection = { index: number; bufOffset: number; tickCount: number }

export type IrsdkBoundsCheck = { ok: true } | { ok: false; reason: string }

function int(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number.NaN
}

/** Byte width of one item of an irsdk var type. Unknown types report 0 (never read). */
export function varItemSize(type: number): number {
  switch (type) {
    case IRSDK_VAR_TYPES.char:
    case IRSDK_VAR_TYPES.bool:
      return 1
    case IRSDK_VAR_TYPES.int:
    case IRSDK_VAR_TYPES.bitfield:
    case IRSDK_VAR_TYPES.float:
      return 4
    case IRSDK_VAR_TYPES.double:
      return 8
    default:
      return 0
  }
}

/** Total byte length a var occupies inside a telemetry buffer, or 0 when undecodable. */
export function varValueByteLength(type: number, count: number): number {
  const size = varItemSize(type)
  const items = int(count)
  if (size === 0 || !Number.isFinite(items) || items <= 0) return 0
  return size * items
}

/** True when [offset, offset+length) is a non-negative range that fits inside `limit`. */
export function isRangeWithin(offset: number, length: number, limit: number | null | undefined): boolean {
  const start = int(offset)
  const size = int(length)
  if (!Number.isFinite(start) || !Number.isFinite(size)) return false
  if (start < 0 || size < 0) return false
  if (limit === null || limit === undefined) return true
  const max = int(limit)
  if (!Number.isFinite(max) || max < 0) return false
  return start + size <= max
}

/** Number of var headers we are willing to walk, clamped against garbage `numVars`. */
export function boundedVarCount(numVars: number): number {
  const count = int(numVars)
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.min(count, MAX_NUM_VARS)
}

/**
 * The buffer to copy is the one with the HIGHEST tick count — never `curBuf`, which is
 * the buffer iRacing is writing into right now and is therefore the most likely to tear.
 * Mirrors irsdk_utils.cpp `latest` selection and pyirsdk's `max(tick_count)`.
 */
export function pickLatestVarBuffer(header: IrsdkHeaderLike): IrsdkVarBufSelection | null {
  const entries = Array.isArray(header?.varBuf) ? header.varBuf : []
  const numBuf = int(header?.numBuf)
  const usable = Math.min(Number.isFinite(numBuf) && numBuf > 0 ? numBuf : 0, IRSDK_MAX_BUFS, entries.length)
  let best: IrsdkVarBufSelection | null = null
  for (let index = 0; index < usable; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const bufOffset = int(entry.bufOffset)
    const tickCount = int(entry.tickCount)
    if (!Number.isFinite(bufOffset) || !Number.isFinite(tickCount)) continue
    // A buffer that starts inside (or before) the header was never initialised.
    if (bufOffset < IRSDK_HEADER_SIZE || tickCount < 0) continue
    if (!best || tickCount > best.tickCount) best = { index, bufOffset, tickCount }
  }
  return best
}

/**
 * Reject a header whose offsets/lengths cannot describe a real memory map. `mapSize` is
 * the size of the mapped view when it could be determined; pass null when unknown, in
 * which case only the map-independent invariants are enforced.
 */
export function validateHeaderBounds(header: IrsdkHeaderLike, mapSize: number | null): IrsdkBoundsCheck {
  const numVars = int(header?.numVars)
  if (!Number.isFinite(numVars) || numVars < 0 || numVars > MAX_NUM_VARS) {
    return { ok: false, reason: `numVars out of range: ${String(header?.numVars)}` }
  }
  const varHeaderOffset = int(header?.varHeaderOffset)
  if (!Number.isFinite(varHeaderOffset) || varHeaderOffset < IRSDK_HEADER_SIZE) {
    return { ok: false, reason: `varHeaderOffset out of range: ${String(header?.varHeaderOffset)}` }
  }
  const numBuf = int(header?.numBuf)
  if (!Number.isFinite(numBuf) || numBuf <= 0 || numBuf > IRSDK_MAX_BUFS) {
    return { ok: false, reason: `numBuf out of range: ${String(header?.numBuf)}` }
  }
  const bufLen = int(header?.bufLen)
  if (!Number.isFinite(bufLen) || bufLen <= 0 || bufLen > MAX_BUF_LEN) {
    return { ok: false, reason: `bufLen out of range: ${String(header?.bufLen)}` }
  }
  const sessionInfoLen = int(header?.sessionInfoLen)
  if (!Number.isFinite(sessionInfoLen) || sessionInfoLen < 0 || sessionInfoLen > MAX_SESSION_INFO_LEN) {
    return { ok: false, reason: `sessionInfoLen out of range: ${String(header?.sessionInfoLen)}` }
  }
  if (!isRangeWithin(varHeaderOffset, numVars * IRSDK_VAR_HEADER_SIZE, mapSize)) {
    return { ok: false, reason: 'var headers fall outside the mapped view' }
  }
  if (sessionInfoLen > 0 && !isRangeWithin(int(header?.sessionInfoOffset), sessionInfoLen, mapSize)) {
    return { ok: false, reason: 'session info falls outside the mapped view' }
  }
  const entries = Array.isArray(header?.varBuf) ? header.varBuf : []
  const usable = Math.min(numBuf, IRSDK_MAX_BUFS, entries.length)
  for (let index = 0; index < usable; index += 1) {
    const bufOffset = int(entries[index]?.bufOffset)
    if (!Number.isFinite(bufOffset)) return { ok: false, reason: `varBuf[${index}] offset is not a number` }
    // 0 marks a buffer iRacing has not published yet — pickLatestVarBuffer skips it.
    if (bufOffset === 0) continue
    if (!isRangeWithin(bufOffset, bufLen, mapSize)) {
      return { ok: false, reason: `varBuf[${index}] falls outside the mapped view` }
    }
  }
  return { ok: true }
}

/**
 * Decode one var out of an already-copied telemetry buffer. Returns undefined — never a
 * fabricated 0 — when the declared range does not fit inside the buffer, so a corrupt var
 * header can neither read out of bounds nor invent a plausible-looking value.
 */
export function decodeVarValue(buffer: Buffer, varHeader: IrsdkVarHeaderLike): unknown {
  const type = int(varHeader?.type)
  const count = Math.max(1, int(varHeader?.count) || 1)
  const offset = int(varHeader?.offset)
  const length = varValueByteLength(type, count)
  if (length === 0) return undefined
  if (!isRangeWithin(offset, length, buffer.length)) return undefined

  const itemSize = varItemSize(type)
  if (type === IRSDK_VAR_TYPES.char) {
    return buffer.toString('utf8', offset, offset + length).replace(/\0.*$/, '')
  }
  const readOne = (index: number): unknown => {
    const pos = offset + index * itemSize
    switch (type) {
      case IRSDK_VAR_TYPES.bool:
        return buffer[pos] !== 0
      case IRSDK_VAR_TYPES.int:
      case IRSDK_VAR_TYPES.bitfield:
        return buffer.readInt32LE(pos)
      case IRSDK_VAR_TYPES.float:
        return buffer.readFloatLE(pos)
      case IRSDK_VAR_TYPES.double:
        return buffer.readDoubleLE(pos)
      default:
        return undefined
    }
  }
  if (count === 1) return readOne(0)
  return Array.from({ length: count }, (_, index) => readOne(index))
}

export type IrsdkNamedVarHeader = IrsdkVarHeaderLike & { name: string }

/** Decode every named var from a copied telemetry buffer. Out-of-bounds vars are skipped. */
export function decodeVarValues(buffer: Buffer, varHeaders: readonly IrsdkNamedVarHeader[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const varHeader of varHeaders) {
    if (!varHeader?.name) continue
    const value = decodeVarValue(buffer, varHeader)
    if (value === undefined) continue
    values[varHeader.name] = value
  }
  return values
}

export type IrsdkFrameSource = {
  /** Decode the 112-byte header. Must re-read live memory on every call. */
  readHeader(): IrsdkHeaderLike | null
  /** Copy `bufLen` bytes starting at `bufOffset` out of the mapped view. */
  copyVarBuffer(bufOffset: number, bufLen: number): Buffer | null
  /** Size of the mapped view, or null when it could not be determined. */
  mapSize(): number | null
}

export type IrsdkFrameFailure =
  | 'no-header'
  | 'invalid-bounds'
  | 'no-buffer'
  | 'copy-failed'
  | 'torn'

export type IrsdkFrame = {
  buffer: Buffer
  header: IrsdkHeaderLike
  bufferIndex: number
  tickCount: number
  attempts: number
}

export type IrsdkFrameOutcome =
  | { ok: true; frame: IrsdkFrame }
  | { ok: false; reason: IrsdkFrameFailure; detail?: string; attempts: number }

/**
 * Read one CONSISTENT telemetry frame.
 *
 * read header -> pick highest tick -> copy the whole buffer -> re-read header ->
 * accept only when that buffer's tick count is unchanged, otherwise retry.
 *
 * A frame that tears on every attempt is reported as `torn` and must NOT be published:
 * publishing it is precisely the defect this guards against.
 */
export function readConsistentVarFrame(source: IrsdkFrameSource, maxAttempts = IRSDK_MAX_BUFS): IrsdkFrameOutcome {
  const attemptLimit = Math.max(1, Math.trunc(maxAttempts) || 1)
  let lastFailure: IrsdkFrameOutcome | null = null
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const header = source.readHeader()
    if (!header) return { ok: false, reason: 'no-header', attempts: attempt }

    const bounds = validateHeaderBounds(header, source.mapSize())
    if (!bounds.ok) return { ok: false, reason: 'invalid-bounds', detail: bounds.reason, attempts: attempt }

    const selection = pickLatestVarBuffer(header)
    if (!selection) return { ok: false, reason: 'no-buffer', attempts: attempt }

    const buffer = source.copyVarBuffer(selection.bufOffset, header.bufLen)
    if (!buffer || buffer.length < header.bufLen) {
      return { ok: false, reason: 'copy-failed', attempts: attempt }
    }

    const after = source.readHeader()
    if (!after) return { ok: false, reason: 'no-header', attempts: attempt }
    const afterTick = int(after.varBuf?.[selection.index]?.tickCount)
    if (afterTick === selection.tickCount) {
      return {
        ok: true,
        frame: {
          buffer,
          header,
          bufferIndex: selection.index,
          tickCount: selection.tickCount,
          attempts: attempt
        }
      }
    }
    lastFailure = { ok: false, reason: 'torn', attempts: attempt }
  }
  return lastFailure ?? { ok: false, reason: 'torn', attempts: attemptLimit }
}
