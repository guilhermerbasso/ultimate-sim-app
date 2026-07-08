import type {
  AppActionCommand,
  IracingCommand,
  IracingCommandName,
  KeyboardMacroCommand
} from './actions'
import type { DashboardPlaylist, DashboardPlaylistItem } from './dashboards'

// ─────────────────────────────────────────────────────────────────────────────
// Editable "RGB button-box" touch panel model.
//
// This is a NEW, self-contained panel type for the "Touch Controls Dash" menu.
// It deliberately does NOT route through gt3-widgets / DashboardRoot — a panel is
// just a grid of fully-styleable buttons, each bound to an existing app action
// (an iRacing broadcast command or a keyboard macro) that fires over the SAME IPC
// the rest of the app already uses (`iracing:command`, `actions:testEmulation`,
// `app:dash:cycle`). Everything here is pure + framework-free so it can be unit
// tested without React or Electron.
// ─────────────────────────────────────────────────────────────────────────────

/** What a button does when pressed. A tiny discriminated union mirroring the
 * existing {@link ActionDefinition} surface, minus the gamepad emulation case
 * (a touch panel has no physical contact to emulate). */
export type ButtonAction =
  | { kind: 'none' }
  | { kind: 'iracing'; command: IracingCommand }
  | { kind: 'keyboard'; command: KeyboardMacroCommand }
  | { kind: 'app'; command: AppActionCommand }

/**
 * Visual material of a key face. Every material derives its colour from the
 * button's `bodyColor`/`borderColor`; the renderer picks the CSS treatment.
 *   backlit    — dark moulded face + neon edge glow (the physical RGB button-box look)
 *   solid      — flat neon fill (the original v2 look; legacy default)
 *   glass      — translucent frosted key
 *   carbon     — carbon-fibre weave + colour accent
 *   toggle     — physical toggle-switch
 *   rotary     — encoder / rotary knob
 *   selector   — multi-position rotary / value selector
 *   rgb        — round RGB halo button
 *   led_status — small on/off status indicator
 *   guarded    — red safety-cover / emergency key (engine start · kill)
 */
export type KeyMaterial =
  | 'backlit'
  | 'solid'
  | 'glass'
  | 'carbon'
  | 'toggle'
  | 'rotary'
  | 'selector'
  | 'rgb'
  | 'led_status'
  | 'guarded'

export const KEY_MATERIALS: ReadonlyArray<KeyMaterial> = [
  'backlit',
  'solid',
  'glass',
  'carbon',
  'toggle',
  'rotary',
  'selector',
  'rgb',
  'led_status',
  'guarded'
]

/** Material for brand-new buttons + curated presets (the high-fidelity look). */
export const DEFAULT_KEY_MATERIAL: KeyMaterial = 'backlit'
/** Material assumed for legacy saved buttons that predate the `material` field. */
export const LEGACY_KEY_MATERIAL: KeyMaterial = 'solid'

/** A single styleable button cell. */
export interface ButtonBoxButton {
  id: string
  label: string
  /** Visual material of the key face (default {@link DEFAULT_KEY_MATERIAL}). */
  material: KeyMaterial
  /** Optional icon id resolved by the renderer's icon registry (Lucide + custom). */
  icon?: string
  /** Body / fill colour (the lit face of the button). */
  bodyColor: string
  /** Label colour. */
  textColor: string
  /** Label size in px. */
  fontSize: number
  /** Lit border colour. */
  borderColor: string
  /** Border thickness in px. */
  borderWidth: number
  /** Optional custom face image (data: URL from an upload). */
  image?: string
  /** What pressing the button does. */
  action: ButtonAction
  /** Body colour while pressed/active (falls back to a derived glow). */
  activeColor?: string
  /** Label colour while pressed/active. */
  activeTextColor?: string
}

/** A grid of buttons that can be saved, added to the dashboard playlist and
 * opened fullscreen on a chosen display. */
export interface ButtonBoxPanel {
  id: string
  name: string
  /** Number of columns in the grid (rows auto-flow). */
  columns: number
  /** Suggested number of rows (used for blank-cell seeding + fullscreen sizing). */
  rows: number
  /** Gap between buttons in px. */
  gap: number
  /** Panel backdrop colour. */
  background: string
  buttons: ButtonBoxButton[]
  createdAt?: number
  updatedAt?: number
  hidden?: boolean
}

export interface ButtonBoxSummary {
  id: string
  name: string
  columns: number
  rows: number
  buttonCount: number
  updatedAt?: number
  hidden?: boolean
}

// ── Bounds ────────────────────────────────────────────────────────────────────
export const PANEL_MIN_COLUMNS = 1
export const PANEL_MAX_COLUMNS = 8
export const PANEL_MIN_ROWS = 1
export const PANEL_MAX_ROWS = 8
export const BUTTON_MIN_FONT = 8
export const BUTTON_MAX_FONT = 96
export const BUTTON_MIN_BORDER = 0
export const BUTTON_MAX_BORDER = 24
export const PANEL_MIN_GAP = 0
export const PANEL_MAX_GAP = 64

export const DEFAULT_BUTTON_BODY = '#1d4ed8'
export const DEFAULT_BUTTON_TEXT = '#f8fafc'
export const DEFAULT_BUTTON_BORDER = '#60a5fa'
export const DEFAULT_PANEL_BG = '#05070d'

// A small neon palette used when seeding fresh buttons so a new panel already
// looks like a physical RGB button box instead of a wall of identical blue keys.
export const NEON_PALETTE: ReadonlyArray<{ body: string; border: string }> = [
  { body: '#1d4ed8', border: '#60a5fa' },
  { body: '#0891b2', border: '#22d3ee' },
  { body: '#16a34a', border: '#4ade80' },
  { body: '#ca8a04', border: '#facc15' },
  { body: '#dc2626', border: '#f87171' },
  { body: '#9333ea', border: '#c084fc' },
  { body: '#db2777', border: '#f472b6' },
  { body: '#ea580c', border: '#fb923c' }
]

function rid(prefix: string): string {
  const rnd =
    (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${rnd}`
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

export function clampColumns(value: unknown): number {
  return clampInt(value, PANEL_MIN_COLUMNS, PANEL_MAX_COLUMNS, 3)
}

export function clampRows(value: unknown): number {
  return clampInt(value, PANEL_MIN_ROWS, PANEL_MAX_ROWS, 2)
}

export function clampFontSize(value: unknown): number {
  return clampInt(value, BUTTON_MIN_FONT, BUTTON_MAX_FONT, 22)
}

export function clampBorderWidth(value: unknown): number {
  return clampInt(value, BUTTON_MIN_BORDER, BUTTON_MAX_BORDER, 2)
}

export function clampGap(value: unknown): number {
  return clampInt(value, PANEL_MIN_GAP, PANEL_MAX_GAP, 14)
}

/** Coerce an unknown into a valid {@link KeyMaterial}; unknown → fallback. */
export function clampMaterial(value: unknown, fallback: KeyMaterial = DEFAULT_KEY_MATERIAL): KeyMaterial {
  return typeof value === 'string' && (KEY_MATERIALS as ReadonlyArray<string>).includes(value)
    ? (value as KeyMaterial)
    : fallback
}

/** Accept a short icon id string (registry-resolved by the renderer); else undefined. */
export function safeIcon(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 ? value : undefined
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Valid keyboard-macro modes, used to sanitise hand-edited/corrupt panel JSON. */
export const KEYBOARD_MACRO_MODES: ReadonlyArray<KeyboardMacroCommand['mode']> = [
  'press',
  'chord',
  'sequence',
  'hold',
  'toggle',
  'repeat'
]

/**
 * Accept a button face image ONLY when it is an inline `data:image/…` URL. A
 * hand-edited / imported panel JSON must never be able to smuggle an external
 * `https://…` (tracking pixel / beacon) or `file://` (local-file read) URL into an
 * `<img src>` that the renderer would fetch. Anything else is dropped.
 */
export function safeImage(value: unknown): string | undefined {
  return typeof value === 'string' && /^data:image\//i.test(value) ? value : undefined
}

// ── iRacing pit tyre corner labels ────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the four pit tyre-toggle corners. iRacing corner codes
// are LF/RF/LR/RR (Left/Right · Front/Rear). Keep these labels here (pure + tested)
// so the editor can NEVER silently swap left/right again — mapping the wrong corner
// destroys a user's pit strategy.
//   L = Esquerdo · R = Direito · F = Dianteiro · R(ear) = Traseiro
export type TyreToggleCommandName =
  | 'pit:toggleTyreLf'
  | 'pit:toggleTyreRf'
  | 'pit:toggleTyreLr'
  | 'pit:toggleTyreRr'

export const TYRE_CORNER_LABELS: Record<TyreToggleCommandName, string> = {
  'pit:toggleTyreLf': 'Dianteiro esquerdo (LF)',
  'pit:toggleTyreRf': 'Dianteiro direito (RF)',
  'pit:toggleTyreLr': 'Traseiro esquerdo (LR)',
  'pit:toggleTyreRr': 'Traseiro direito (RR)'
}

// ── Grid resizing ─────────────────────────────────────────────────────────────
/**
 * Resize a panel's button list to exactly `count` cells (typically columns*rows).
 * Growing appends fresh neon "placeholder" cells (blank label so the renderer marks
 * them `is-empty`); shrinking truncates from the end. Never mutates the input.
 */
export function resizePanelButtons(buttons: ButtonBoxButton[], count: number): ButtonBoxButton[] {
  const target = Math.max(0, Math.round(Number.isFinite(count) ? count : buttons.length))
  if (target === buttons.length) return buttons.slice()
  if (target < buttons.length) return buttons.slice(0, target)
  const next = buttons.slice()
  for (let i = buttons.length; i < target; i += 1) {
    next.push(createButtonBoxButton({ label: '' }, i))
  }
  return next
}

// ── Image upload size guard ───────────────────────────────────────────────────
/** Max encoded size (bytes) allowed for a per-button face image before it is
 * downscaled. Keeps panel JSON + IPC payloads small (a data-URL rides inside the
 * saved panel). ~200 KB comfortably covers a crisp key face at 7" panel density. */
export const IMAGE_MAX_BYTES = 200_000

/** Best-effort decoded byte length of a data URL (base64 or raw payload). */
export function estimateDataUrlBytes(dataUrl: string): number {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return 0
  const comma = dataUrl.indexOf(',')
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  if (payload.length === 0) return 0
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const isBase64 = /;base64/i.test(header)
  if (!isBase64) return payload.length
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

/** True when a data URL is small enough to store inline without downscaling. */
export function isDataUrlWithinLimit(dataUrl: string, max: number = IMAGE_MAX_BYTES): boolean {
  return estimateDataUrlBytes(dataUrl) <= max
}


// ── Factories ───────────────────────────────────────────────────────────────
export function createButtonBoxButton(partial: Partial<ButtonBoxButton> = {}, paletteIndex = 0): ButtonBoxButton {
  const swatch = NEON_PALETTE[((paletteIndex % NEON_PALETTE.length) + NEON_PALETTE.length) % NEON_PALETTE.length]
  return {
    id: partial.id ?? rid('btn'),
    label: partial.label ?? `Botão ${paletteIndex + 1}`,
    material: clampMaterial(partial.material),
    icon: safeIcon(partial.icon),
    bodyColor: partial.bodyColor ?? swatch.body,
    textColor: partial.textColor ?? DEFAULT_BUTTON_TEXT,
    fontSize: clampFontSize(partial.fontSize),
    borderColor: partial.borderColor ?? swatch.border,
    borderWidth: clampBorderWidth(partial.borderWidth ?? 2),
    image: safeImage(partial.image),
    action: normalizeAction(partial.action),
    activeColor: typeof partial.activeColor === 'string' ? partial.activeColor : undefined,
    activeTextColor: typeof partial.activeTextColor === 'string' ? partial.activeTextColor : undefined
  }
}

export type ButtonBoxPanelInit = Omit<Partial<ButtonBoxPanel>, 'buttons'> & {
  buttons?: Array<Partial<ButtonBoxButton>>
}

export function createButtonBoxPanel(partial: ButtonBoxPanelInit = {}): ButtonBoxPanel {
  const columns = clampColumns(partial.columns ?? 3)
  const rows = clampRows(partial.rows ?? 2)
  const now = Date.now()
  const buttons = Array.isArray(partial.buttons)
    ? partial.buttons.map((b, i) => createButtonBoxButton(b, i))
    : Array.from({ length: columns * rows }, (_, i) => createButtonBoxButton({}, i))
  return {
    id: partial.id ?? rid('panel'),
    name: partial.name ?? 'Novo button box',
    columns,
    rows,
    gap: clampGap(partial.gap ?? 14),
    background: str(partial.background, DEFAULT_PANEL_BG),
    buttons,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    hidden: Boolean(partial.hidden)
  }
}

// ── Action normalisation + mapping ────────────────────────────────────────────
export function normalizeAction(raw: unknown): ButtonAction {
  if (!raw || typeof raw !== 'object') return { kind: 'none' }
  const candidate = raw as { kind?: unknown; command?: unknown }
  switch (candidate.kind) {
    case 'iracing':
      if (candidate.command && typeof candidate.command === 'object') {
        return { kind: 'iracing', command: candidate.command as IracingCommand }
      }
      return { kind: 'none' }
    case 'keyboard':
      if (candidate.command && typeof candidate.command === 'object') {
        const cmd = candidate.command as Partial<KeyboardMacroCommand>
        const mode: KeyboardMacroCommand['mode'] =
          cmd.mode && KEYBOARD_MACRO_MODES.includes(cmd.mode) ? cmd.mode : 'press'
        const keys = Array.isArray(cmd.keys) ? cmd.keys.filter((k): k is string => typeof k === 'string') : []
        return { kind: 'keyboard', command: { ...cmd, mode, keys } }
      }
      return { kind: 'none' }
    case 'app':
      if (candidate.command && typeof candidate.command === 'object') {
        return { kind: 'app', command: candidate.command as AppActionCommand }
      }
      return { kind: 'none' }
    default:
      return { kind: 'none' }
  }
}

export interface ButtonActionIpc {
  channel: string
  args: unknown[]
}

/**
 * Map a button's bound action onto the concrete IPC call the renderer should
 * make. Reuses the EXISTING channels:
 *   - `iracing:command`        — broadcast pit/camera/black-box commands
 *   - `actions:testEmulation`  — fire a keyboard macro
 *   - `app:dash:cycle`         — playlist next/prev
 *   - `oled:setActivePage` / `overlays:toggle` — app actions
 * Returns null when there is nothing to do (`none`).
 */
export function buttonActionToIpc(action: ButtonAction): ButtonActionIpc | null {
  switch (action.kind) {
    case 'none':
      return null
    case 'iracing':
      return { channel: 'iracing:command', args: [action.command] }
    case 'keyboard':
      return { channel: 'actions:testEmulation', args: [{ type: 'keyboard', command: action.command }] }
    case 'app':
      switch (action.command.name) {
        case 'dash:cycleNext':
          return { channel: 'app:dash:cycle', args: ['next'] }
        case 'dash:cyclePrev':
          return { channel: 'app:dash:cycle', args: ['prev'] }
        case 'oled:setActivePage':
          return { channel: 'oled:setActivePage', args: [action.command.pageIndex ?? 0] }
        case 'overlays:toggle':
          return { channel: 'overlays:toggle', args: [action.command.overlayId ?? 'relative'] }
        default:
          return null
      }
    default:
      return null
  }
}

/** Short human label describing what a button is bound to (for the editor). */
export function describeButtonAction(action: ButtonAction): string {
  switch (action.kind) {
    case 'none':
      return 'Sem ação'
    case 'iracing':
      return `iRacing · ${action.command.name}`
    case 'keyboard':
      return `Teclado · ${action.command.keys.join(' + ') || '(vazio)'}`
    case 'app':
      return `App · ${action.command.name}`
    default:
      return 'Sem ação'
  }
}

// ── Normalisation (parse) + serialisation ─────────────────────────────────────
export function normalizeButtonBoxButton(raw: unknown, index = 0): ButtonBoxButton {
  if (!raw || typeof raw !== 'object') return createButtonBoxButton({}, index)
  const b = raw as Partial<ButtonBoxButton>
  // Legacy panels predate `material`: assume the original flat-neon look so a
  // user's saved boxes render exactly as before (new buttons default to backlit).
  return createButtonBoxButton({ ...b, material: clampMaterial(b.material, LEGACY_KEY_MATERIAL) }, index)
}

export function parseButtonBoxPanel(raw: unknown): ButtonBoxPanel | null {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const p = value as Partial<ButtonBoxPanel> & { id?: unknown; name?: unknown }
  if (typeof p.id !== 'string' || !p.id) return null
  const columns = clampColumns(p.columns)
  const rows = clampRows(p.rows)
  const buttons = Array.isArray(p.buttons) ? p.buttons.map((b, i) => normalizeButtonBoxButton(b, i)) : []
  return {
    id: p.id,
    name: str(p.name, 'Button box'),
    columns,
    rows,
    gap: clampGap(p.gap),
    background: str(p.background, DEFAULT_PANEL_BG),
    buttons,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : undefined,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : undefined,
    hidden: Boolean(p.hidden)
  }
}

export function serializeButtonBoxPanel(panel: ButtonBoxPanel): string {
  return JSON.stringify(panel, null, 2)
}

export function summarizeButtonBoxPanel(panel: ButtonBoxPanel): ButtonBoxSummary {
  return {
    id: panel.id,
    name: panel.name,
    columns: panel.columns,
    rows: panel.rows,
    buttonCount: panel.buttons.length,
    updatedAt: panel.updatedAt,
    hidden: Boolean(panel.hidden)
  }
}

// ── Playlist integration ──────────────────────────────────────────────────────
// A touch panel rides in the SAME dashboard playlist as regular dashboards via an
// additive discriminator. The `dashboardId` field carries the panel id so the
// existing string-keyed persistence keeps the item; `kind`/`touchPanelId` tell the
// manager (and the playlist UI) to open it as a button-box window instead.

export interface TouchPanelOpenOptions {
  displayId?: number
  fullscreen?: boolean
}

export function isTouchPanelPlaylistItem(item: DashboardPlaylistItem): boolean {
  return item.kind === 'touch-panel' || typeof item.touchPanelId === 'string'
}

export function buttonPanelPlaylistItem(
  panelId: string,
  opts: TouchPanelOpenOptions = {}
): DashboardPlaylistItem {
  return {
    dashboardId: panelId,
    touchPanelId: panelId,
    kind: 'touch-panel',
    displayId: typeof opts.displayId === 'number' ? opts.displayId : undefined,
    fullscreen: typeof opts.fullscreen === 'boolean' ? opts.fullscreen : undefined
  }
}

export function addButtonPanelToPlaylist(
  playlist: DashboardPlaylist,
  panelId: string,
  opts: TouchPanelOpenOptions = {}
): DashboardPlaylist {
  const items = Array.isArray(playlist?.items) ? playlist.items : []
  return {
    items: [...items, buttonPanelPlaylistItem(panelId, opts)],
    updatedAt: Date.now()
  }
}
