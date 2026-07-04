// SimHub Arduino config importer.
//
// Reads %USERPROFILE%/Documents/SimHub/arduinosetupsettings.json (or the
// _Arduino sub-folder) and maps the LastPreset.Content items into a
// DeviceProfile + RgbMatrixComponent so the user can adopt SimHub's confirmed
// working wiring straight from the Hardware menu.
//
// WS2812B_MATRIX_SERPENTINELAYOUTREVERSE:
//   SimHub's "serpentine reverse" flips the starting corner of the zigzag so
//   that odd rows run right→left starting from the right end instead of the
//   left end.  In our MatrixLayout this maps to flipX=true (mirror logical
//   columns before the serpentine scan) because reversing which end the wire
//   enters is equivalent to a horizontal mirror of the physical panel combined
//   with keeping the serpentine direction.  When SERPENTINELAYOUT is also 0
//   this flag has no visible effect, so we only apply the flipX when
//   serpentine=true.

import type { App } from 'electron'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SimHubDetection,
  SimHubImportResult,
  SimHubMatrixConfig,
  SimHubParsedSetup
} from '../../shared/simhub'
import type { MatrixLayout } from '../../shared/rgb-matrix'
import type { BoardId, DeviceProfile, RgbMatrixComponent } from '../../shared/devices'

// ─── SimHub JSON shapes (internal to this module) ─────────────────────────────

export interface SimHubContentItem {
  Group: string
  Name: string
  Title: string
  DefaultValue: string | number
  Type: string
  Value?: string | number | null
}

export interface SimHubLastPreset {
  Version?: string
  BoardId?: string
  Title?: string
  SerialPort?: string
  Content: SimHubContentItem[]
}

/** Shape of SimHub's arduinosetupsettings.json at top level. */
export interface SimHubArduinoSetup {
  LastPreset?: SimHubLastPreset
}

// ─── Board id mapping ─────────────────────────────────────────────────────────

// Maps SimHub's internal board ids to our BoardId values.
const SIMHUB_BOARD_MAP: Record<string, BoardId> = {
  nanoold: 'nano',
  nano: 'nano',
  uno: 'uno',
  mega2560: 'mega2560',
  leonardo: 'leonardo',
  promicro: 'pro-micro',
  'pro-micro': 'pro-micro',
  esp32: 'esp32',
  esp32s3: 'esp32s3',
  esp8266: 'esp8266'
}

function mapBoardId(simhubId: string): BoardId {
  return SIMHUB_BOARD_MAP[simhubId.toLowerCase()] ?? 'generic'
}

// ─── Pin label helpers ────────────────────────────────────────────────────────

/** Converts an integer pin number from SimHub to the pin label our app uses. */
function pinLabel(pinNum: number, board: BoardId): string {
  if (board === 'esp32' || board === 'esp32s3' || board === 'esp8266') {
    return `GPIO${pinNum}`
  }
  return `D${pinNum}`
}

// ─── parseArduinoSetup ────────────────────────────────────────────────────────

function coerceBool(value: string | number | null | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  const n = Number(value)
  if (!Number.isNaN(n)) return n !== 0
  const s = String(value).toLowerCase()
  return s === 'true' || s === '1'
}

function coerceInt(value: string | number | null | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/**
 * Resolves the effective value of a Content item: prefer .Value when set and
 * non-null, otherwise fall back to .DefaultValue.
 */
function effectiveValue(item: SimHubContentItem): string | number | null {
  return item.Value !== undefined && item.Value !== null ? item.Value : item.DefaultValue
}

/**
 * Converts SimHub's LastPreset into a SimHubParsedSetup.
 * All fields default gracefully when absent.
 */
export function parseArduinoSetup(json: SimHubArduinoSetup): SimHubParsedSetup {
  const preset = json.LastPreset ?? ({ Content: [] } as SimHubLastPreset)
  const content = Array.isArray(preset.Content) ? preset.Content : []

  // Build a lookup map Name → effective value for O(1) access.
  const lookup = new Map<string, string | number | null>()
  for (const item of content) {
    if (typeof item.Name === 'string') {
      lookup.set(item.Name, effectiveValue(item))
    }
  }

  const simhubBoardId = typeof preset.BoardId === 'string' ? preset.BoardId : 'generic'
  const board = mapBoardId(simhubBoardId)

  const matrix: SimHubMatrixConfig = {
    enabled: coerceBool(lookup.get('WS2812B_MATRIX_ENABLED'), false),
    dataPin: coerceInt(lookup.get('WS2812B_MATRIX_DATAPIN'), 6),
    serpentine: coerceBool(lookup.get('WS2812B_MATRIX_SERPENTINELAYOUT'), true),
    serpentineRev: coerceBool(lookup.get('WS2812B_MATRIX_SERPENTINELAYOUTREVERSE'), false),
    leftRightMirror: coerceBool(lookup.get('WS2812B_MATRIX_LEFTRIGHTMIRROR'), false)
  }

  return {
    simhubBoardId,
    board,
    title: typeof preset.Title === 'string' ? preset.Title : '',
    serialPort: typeof preset.SerialPort === 'string' ? preset.SerialPort : '',
    matrix
  }
}

// ─── Build MatrixLayout from parsed config ────────────────────────────────────

/**
 * Maps SimHub's matrix wiring flags to our MatrixLayout type.
 *
 * | SimHub key                         | MatrixLayout field  | Notes                         |
 * |------------------------------------|---------------------|-------------------------------|
 * | WS2812B_MATRIX_SERPENTINELAYOUT    | serpentine          | Direct boolean map            |
 * | WS2812B_MATRIX_LEFTRIGHTMIRROR     | flipX               | Mirror before serpentine scan |
 * | WS2812B_MATRIX_SERPENTINELAYOUTREVERSE | flipX (additive) | See module-level comment  |
 * | (not exposed by SimHub)            | rotation            | Defaults to 0                 |
 * | (not exposed by SimHub)            | flipY               | Defaults to false             |
 */
export function matrixLayoutFromParsed(parsed: SimHubParsedSetup): MatrixLayout {
  const { matrix } = parsed
  // leftRightMirror is a direct horizontal flip.
  // serpentineRev reverses which end each odd row starts from, which is
  // equivalent to flipX when serpentine is active.  XOR them: if both are set
  // they cancel out.
  const flipX = matrix.leftRightMirror !== (matrix.serpentine && matrix.serpentineRev)
  return {
    serpentine: matrix.serpentine,
    rotation: 0,
    flipX,
    flipY: false
  }
}

// ─── Build DeviceProfile from parsed config ───────────────────────────────────

/** Produces a partial DeviceProfile suitable for passing to DeviceConfigStore.save(). */
export function buildProfileFromParsed(parsed: SimHubParsedSetup): Partial<DeviceProfile> {
  const { board, matrix, title } = parsed
  const now = new Date().toISOString()
  const label = title ? `SimHub Import — ${title}` : 'SimHub Import'

  const matrixComponent: Omit<RgbMatrixComponent, 'id'> = {
    type: 'rgbMatrix',
    label: 'iFlag 8x8 (SimHub)',
    enabled: matrix.enabled,
    chip: 'ws2812',
    width: 8,
    height: 8,
    brightness: 120,
    orientation: 0,
    serpentine: matrix.serpentine,
    mode: 'iflag',
    pins: { data: pinLabel(matrix.dataPin, board) }
  }

  return {
    label,
    board,
    baud: 115200,
    components: [
      {
        ...matrixComponent,
        id: `rgbMatrix-simhub-${Date.now().toString(36)}`
      }
    ],
    createdAt: now,
    updatedAt: now
  }
}

// ─── File system helpers ──────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findArduinoSetupFile(simhubRoot: string): Promise<string | null> {
  const candidates = [
    join(simhubRoot, 'arduinosetupsettings.json'),
    join(simhubRoot, '_Arduino', 'arduinosetupsettings.json')
  ]
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Locates Documents/SimHub and reads arduinosetupsettings.json.
 * Returns a SimHubDetection: either found=true with the parsed config, or
 * found=false with a human-readable reason.
 */
export async function detectSimHub(app: App): Promise<SimHubDetection> {
  const simhubRoot = join(app.getPath('documents'), 'SimHub')

  if (!(await fileExists(simhubRoot))) {
    return { found: false, reason: `SimHub folder not found at: ${simhubRoot}` }
  }

  const configPath = await findArduinoSetupFile(simhubRoot)
  if (!configPath) {
    return {
      found: false,
      reason: `arduinosetupsettings.json not found inside ${simhubRoot} (checked root and _Arduino/).`
    }
  }

  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (err) {
    return { found: false, reason: `Failed to read ${configPath}: ${String(err)}` }
  }

  let json: SimHubArduinoSetup
  try {
    json = JSON.parse(raw) as SimHubArduinoSetup
  } catch {
    return { found: false, reason: `Invalid JSON in ${configPath}` }
  }

  if (!json.LastPreset) {
    return { found: false, reason: 'arduinosetupsettings.json has no LastPreset entry.' }
  }

  const parsed = parseArduinoSetup(json)
  return { found: true, configPath, parsed }
}

/**
 * Detects SimHub, parses the setup file, and returns a ready-to-save
 * DeviceProfile partial plus the derived MatrixLayout.
 * Throws if SimHub is not found or the file is unreadable.
 */
export async function importFromSimHub(app: App): Promise<SimHubImportResult> {
  const detection = await detectSimHub(app)
  if (!detection.found) throw new Error(detection.reason)

  const profile = buildProfileFromParsed(detection.parsed)
  const layout = matrixLayoutFromParsed(detection.parsed)
  return { profile: profile as DeviceProfile, layout }
}
