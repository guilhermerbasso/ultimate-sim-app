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
// just a grid of fully-styleable buttons, each bound to a semantic app action
// that crosses one runtime-validated Touch IPC boundary. Everything here is pure
// and framework-free so it can be unit
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

/** Current on-disk/export schema. Panels without a version are migrated from v1. */
export const TOUCH_PANEL_SCHEMA_VERSION = 2 as const

export type TouchControlKind =
  | 'momentary'
  | 'latching-toggle'
  | 'two-position-rocker'
  | 'guarded-two-step'
  | 'rotary'
  | 'selector'
  | 'status-led'
  | 'value-tile'

export const TOUCH_CONTROL_KINDS: ReadonlyArray<TouchControlKind> = [
  'momentary',
  'latching-toggle',
  'two-position-rocker',
  'guarded-two-step',
  'rotary',
  'selector',
  'status-led',
  'value-tile'
]

export interface TouchRepeatConfig {
  /** Delay before auto-repeat begins. */
  delayMs: number
  /** Gap between repeated detents/presses. */
  intervalMs: number
}

export interface TouchSelectorChoice {
  id: string
  label: string
  value: string
  action: ButtonAction
}

/**
 * The control mechanism is deliberately independent from its visual material.
 * Multi-zone controls use fixed named slots rather than arbitrary action arrays,
 * which makes imports deterministic and prevents hidden extra actions.
 */
export type TouchControl =
  | { kind: 'momentary'; action: ButtonAction; repeat?: TouchRepeatConfig }
  | { kind: 'latching-toggle'; onAction: ButtonAction; offAction: ButtonAction }
  | {
      kind: 'two-position-rocker'
      negativeAction: ButtonAction
      positiveAction: ButtonAction
      negativeLabel: string
      positiveLabel: string
      repeat?: TouchRepeatConfig
    }
  | { kind: 'guarded-two-step'; action: ButtonAction; armTimeoutMs: number }
  | {
      kind: 'rotary'
      decrementAction: ButtonAction
      incrementAction: ButtonAction
      decrementLabel: string
      incrementLabel: string
      repeat: TouchRepeatConfig
    }
  | { kind: 'selector'; choices: TouchSelectorChoice[]; initialChoiceId: string }
  | { kind: 'status-led'; value: string }
  | { kind: 'value-tile'; value: string; unit?: string }

export type TouchControlStateDestination = 'active' | 'pressed' | 'disabled' | 'warning' | 'value'

export const TOUCH_CONTROL_STATE_DESTINATIONS: ReadonlyArray<TouchControlStateDestination> = [
  'active',
  'pressed',
  'disabled',
  'warning',
  'value'
]

/** Reference only: evaluation remains owned by the existing expression engine. */
export interface TouchExpressionStateBinding {
  source: 'expression'
  expressionId: string
}

export type TouchControlStateBindings = Partial<
  Record<TouchControlStateDestination, TouchExpressionStateBinding>
>

export interface TouchControlStateDefaults {
  active?: boolean
  pressed?: boolean
  disabled?: boolean
  warning?: boolean
  value?: string | number | boolean | null
}

export type ButtonShape =
  | 'round'
  | 'square'
  | 'wide'
  | 'pill'
  | 'guarded'
  | 'rotary'
  | 'rocker'
  | 'led-ring'
  | 'status'

export const BUTTON_SHAPES: ReadonlyArray<ButtonShape> = [
  'round',
  'square',
  'wide',
  'pill',
  'guarded',
  'rotary',
  'rocker',
  'led-ring',
  'status'
]

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
 *   rocker     — horizontal plus/minus rocker
 *   led_ring   — illuminated button with LED halo
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
  | 'rocker'
  | 'led_ring'
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
  'rocker',
  'led_ring',
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
  /** Interaction semantics. Never inferred by the renderer from `material`. */
  control: TouchControl
  /** Geometry/chrome family, independent from interaction semantics. */
  shape: ButtonShape
  state?: TouchControlStateDefaults
  stateBindings?: TouchControlStateBindings
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
  /** Optional custom raster face image (inline data URL only). */
  image?: string
  /** Persistent active-state colours. */
  activeColor?: string
  /** Persistent active-state SVG label colour. */
  activeTextColor?: string
  /** Pointer/key-down colours. */
  pressedColor?: string
  pressedTextColor?: string
  /** Disabled-state colours. */
  disabledColor?: string
  disabledTextColor?: string
  /** Warning-state colours. */
  warningColor?: string
  warningTextColor?: string
}

/** Input accepted by factories while old preset source files still use `action`. */
export type ButtonBoxButtonInput = Partial<ButtonBoxButton> & { action?: ButtonAction }

/** A grid of buttons that can be saved, added to the dashboard playlist and
 * opened fullscreen on a chosen display. */
export interface ButtonBoxPanel {
  schemaVersion: typeof TOUCH_PANEL_SCHEMA_VERSION
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
  /** Optional picker tags for built-in presets and user panels. */
  tags?: string[]
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
export const CONTROL_REPEAT_MIN_MS = 50
export const CONTROL_REPEAT_MAX_MS = 2_000
export const CONTROL_REPEAT_DEFAULT_DELAY_MS = 420
export const CONTROL_REPEAT_DEFAULT_INTERVAL_MS = 120
export const GUARD_ARM_MIN_MS = 1_000
export const GUARD_ARM_MAX_MS = 15_000

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

export function clampShape(value: unknown, fallback: ButtonShape = 'square'): ButtonShape {
  return typeof value === 'string' && (BUTTON_SHAPES as ReadonlyArray<string>).includes(value)
    ? (value as ButtonShape)
    : fallback
}

export function defaultShapeForMaterial(material: KeyMaterial): ButtonShape {
  switch (material) {
    case 'rgb':
      return 'round'
    case 'guarded':
      return 'guarded'
    case 'rotary':
    case 'selector':
      return 'rotary'
    case 'rocker':
      return 'rocker'
    case 'led_ring':
      return 'led-ring'
    case 'led_status':
      return 'status'
    case 'toggle':
      return 'pill'
    default:
      return 'square'
  }
}

/** Accept only CSS hex colours. Imports cannot inject url(), var(), or arbitrary CSS. */
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    ? value
    : fallback
}

/** Accept a short icon id string (registry-resolved by the renderer); else undefined. */
export function safeIcon(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(value) ? value : undefined
}

export function safeControlId(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : fallback
}

function safeText(value: unknown, fallback: string, max = 80): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
}

function str(value: unknown, fallback: string): string {
  return safeText(value, fallback, 96)
}

function safeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 32)
  return tags.length > 0 ? Array.from(new Set(tags)) : undefined
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
export const TOUCH_KEYBOARD_MAX_KEYS = 12
export const TOUCH_KEYBOARD_MAX_SEQUENCE_KEYS = 64

/** Allow only small inline raster images; SVG/external/file/javascript URLs are rejected. */
export function safeImage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return undefined
  return isDataUrlWithinLimit(value) ? value : undefined
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
    next.push(createButtonBoxButton({ label: '', control: { kind: 'value-tile', value: '' } }, i))
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


// ── Semantic controls ──────────────────────────────────────────────────────────
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizeRepeatConfig(raw: unknown, fallback?: TouchRepeatConfig): TouchRepeatConfig | undefined {
  if (raw === undefined && fallback === undefined) return undefined
  const value = recordOf(raw) ?? {}
  const base = fallback ?? {
    delayMs: CONTROL_REPEAT_DEFAULT_DELAY_MS,
    intervalMs: CONTROL_REPEAT_DEFAULT_INTERVAL_MS
  }
  return {
    delayMs: clampInt(value.delayMs, CONTROL_REPEAT_MIN_MS, CONTROL_REPEAT_MAX_MS, base.delayMs),
    intervalMs: clampInt(value.intervalMs, CONTROL_REPEAT_MIN_MS, CONTROL_REPEAT_MAX_MS, base.intervalMs)
  }
}

export function createTouchControl(kind: TouchControlKind, action: ButtonAction = { kind: 'none' }): TouchControl {
  const safeAction = normalizeAction(action)
  switch (kind) {
    case 'latching-toggle':
      return { kind, onAction: safeAction, offAction: safeAction }
    case 'two-position-rocker':
      return {
        kind,
        negativeAction: { kind: 'none' },
        positiveAction: safeAction,
        negativeLabel: 'Decrease',
        positiveLabel: 'Increase',
        repeat: normalizeRepeatConfig({}, undefined)
      }
    case 'guarded-two-step':
      return { kind, action: safeAction, armTimeoutMs: 4_000 }
    case 'rotary':
      return {
        kind,
        decrementAction: { kind: 'none' },
        incrementAction: safeAction,
        decrementLabel: 'Decrease',
        incrementLabel: 'Increase',
        repeat: normalizeRepeatConfig({}, undefined)!
      }
    case 'selector': {
      const choices: TouchSelectorChoice[] = [
        { id: 'choice-1', label: '1', value: '1', action: { kind: 'none' } },
        { id: 'choice-2', label: '2', value: '2', action: safeAction }
      ]
      return { kind, choices, initialChoiceId: choices[0].id }
    }
    case 'status-led':
      return { kind, value: 'OFF' }
    case 'value-tile':
      return { kind, value: '--' }
    case 'momentary':
    default:
      return { kind: 'momentary', action: safeAction }
  }
}

function inferNewControl(material: KeyMaterial, action: ButtonAction): TouchControl {
  if (material === 'guarded') return createTouchControl('guarded-two-step', action)
  if (material === 'toggle') {
    if (action.kind === 'keyboard' && action.command.mode === 'hold') return createTouchControl('momentary', action)
    return createTouchControl('latching-toggle', action)
  }
  if (material === 'led_status') {
    return action.kind === 'none' ? createTouchControl('status-led') : createTouchControl('latching-toggle', action)
  }
  return createTouchControl('momentary', action)
}

function normalizedChoice(raw: unknown, index: number): TouchSelectorChoice | null {
  const value = recordOf(raw)
  if (!value) return null
  const id = safeControlId(value.id, `choice-${index + 1}`)
  return {
    id,
    label: safeText(value.label, `${index + 1}`, 32),
    value: safeText(value.value, `${index + 1}`, 64),
    action: normalizeAction(value.action)
  }
}

/** Normalise a fixed-shape control union. No arbitrary zones/actions survive. */
export function normalizeTouchControl(
  raw: unknown,
  fallbackAction: ButtonAction = { kind: 'none' },
  material: KeyMaterial = DEFAULT_KEY_MATERIAL,
  legacy = false
): TouchControl {
  if (legacy && !recordOf(raw)) return createTouchControl('momentary', fallbackAction)
  const value = recordOf(raw)
  if (!value || typeof value.kind !== 'string') return inferNewControl(material, fallbackAction)
  switch (value.kind) {
    case 'momentary':
      return {
        kind: 'momentary',
        action: normalizeAction(value.action),
        repeat: normalizeRepeatConfig(value.repeat)
      }
    case 'latching-toggle':
      return {
        kind: 'latching-toggle',
        onAction: normalizeAction(value.onAction),
        offAction: normalizeAction(value.offAction)
      }
    case 'two-position-rocker':
      return {
        kind: 'two-position-rocker',
        negativeAction: normalizeAction(value.negativeAction),
        positiveAction: normalizeAction(value.positiveAction),
        negativeLabel: safeText(value.negativeLabel, 'Decrease', 32),
        positiveLabel: safeText(value.positiveLabel, 'Increase', 32),
        repeat: normalizeRepeatConfig(value.repeat)
      }
    case 'guarded-two-step':
      return {
        kind: 'guarded-two-step',
        action: normalizeAction(value.action),
        armTimeoutMs: clampInt(value.armTimeoutMs, GUARD_ARM_MIN_MS, GUARD_ARM_MAX_MS, 4_000)
      }
    case 'rotary':
      return {
        kind: 'rotary',
        decrementAction: normalizeAction(value.decrementAction),
        incrementAction: normalizeAction(value.incrementAction),
        decrementLabel: safeText(value.decrementLabel, 'Decrease', 32),
        incrementLabel: safeText(value.incrementLabel, 'Increase', 32),
        repeat: normalizeRepeatConfig(value.repeat, {
          delayMs: CONTROL_REPEAT_DEFAULT_DELAY_MS,
          intervalMs: CONTROL_REPEAT_DEFAULT_INTERVAL_MS
        })!
      }
    case 'selector': {
      const seen = new Set<string>()
      const choices = (Array.isArray(value.choices) ? value.choices : [])
        .slice(0, 12)
        .map(normalizedChoice)
        .filter((choice): choice is TouchSelectorChoice => {
          if (!choice || seen.has(choice.id)) return false
          seen.add(choice.id)
          return true
        })
      if (choices.length < 2) return createTouchControl('selector', fallbackAction)
      const requested = typeof value.initialChoiceId === 'string' ? value.initialChoiceId : ''
      return {
        kind: 'selector',
        choices,
        initialChoiceId: choices.some((choice) => choice.id === requested) ? requested : choices[0].id
      }
    }
    case 'status-led':
      return { kind: 'status-led', value: safeText(value.value, 'OFF', 64) }
    case 'value-tile':
      return {
        kind: 'value-tile',
        value: safeText(value.value, '--', 64),
        unit: typeof value.unit === 'string' ? safeText(value.unit, '', 16) || undefined : undefined
      }
    default:
      return inferNewControl(material, fallbackAction)
  }
}

const CONTROL_KEYS: Record<TouchControlKind, ReadonlyArray<string>> = {
  momentary: ['kind', 'action', 'repeat'],
  'latching-toggle': ['kind', 'onAction', 'offAction'],
  'two-position-rocker': [
    'kind',
    'negativeAction',
    'positiveAction',
    'negativeLabel',
    'positiveLabel',
    'repeat'
  ],
  'guarded-two-step': ['kind', 'action', 'armTimeoutMs'],
  rotary: ['kind', 'decrementAction', 'incrementAction', 'decrementLabel', 'incrementLabel', 'repeat'],
  selector: ['kind', 'choices', 'initialChoiceId'],
  'status-led': ['kind', 'value'],
  'value-tile': ['kind', 'value', 'unit']
}

/** Strict validator used before save/import; normalisation remains tolerant for v1 migration. */
export function validateTouchControl(raw: unknown): string[] {
  const value = recordOf(raw)
  if (!value || typeof value.kind !== 'string' || !TOUCH_CONTROL_KINDS.includes(value.kind as TouchControlKind)) {
    return ['control.kind is invalid']
  }
  const kind = value.kind as TouchControlKind
  const errors: string[] = []
  const allowed = new Set(CONTROL_KEYS[kind])
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`control.${kind} has unexpected field "${key}"`)
  const actionSlots: Record<TouchControlKind, string[]> = {
    momentary: ['action'],
    'latching-toggle': ['onAction', 'offAction'],
    'two-position-rocker': ['negativeAction', 'positiveAction'],
    'guarded-two-step': ['action'],
    rotary: ['decrementAction', 'incrementAction'],
    selector: [],
    'status-led': [],
    'value-tile': []
  }
  for (const slot of actionSlots[kind]) {
    if (!isValidButtonAction(value[slot])) errors.push(`control.${kind}.${slot} is invalid`)
  }
  if (kind === 'selector') {
    if (!Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 12) {
      errors.push('control.selector.choices must contain 2-12 choices')
    } else {
      const ids = new Set<string>()
      value.choices.forEach((choice, index) => {
        const item = recordOf(choice)
        if (!item || typeof item.id !== 'string' || !item.id) errors.push(`control.selector.choices[${index}].id is invalid`)
        else if (ids.has(item.id)) errors.push(`control.selector choice id "${item.id}" is duplicated`)
        else ids.add(item.id)
        if (!item || !isValidButtonAction(item.action)) errors.push(`control.selector.choices[${index}].action is invalid`)
      })
      if (typeof value.initialChoiceId !== 'string' || !ids.has(value.initialChoiceId)) {
        errors.push('control.selector.initialChoiceId must reference a choice')
      }
    }
  }
  return errors
}

export function primaryButtonAction(control: TouchControl): ButtonAction {
  switch (control.kind) {
    case 'momentary':
    case 'guarded-two-step':
      return control.action
    case 'latching-toggle':
      return control.onAction
    case 'two-position-rocker':
      return control.positiveAction
    case 'rotary':
      return control.incrementAction
    case 'selector':
      return control.choices.find((choice) => choice.id === control.initialChoiceId)?.action ?? { kind: 'none' }
    case 'status-led':
    case 'value-tile':
      return { kind: 'none' }
  }
}

export function buttonControlActions(control: TouchControl): ButtonAction[] {
  switch (control.kind) {
    case 'momentary':
    case 'guarded-two-step':
      return [control.action]
    case 'latching-toggle':
      return [control.onAction, control.offAction]
    case 'two-position-rocker':
      return [control.negativeAction, control.positiveAction]
    case 'rotary':
      return [control.decrementAction, control.incrementAction]
    case 'selector':
      return control.choices.map((choice) => choice.action)
    case 'status-led':
    case 'value-tile':
      return []
  }
}
export function touchControlStateDestinationId(
  panelId: string,
  controlId: string,
  destination: TouchControlStateDestination
): string {
  return `touch-control:${safeControlId(panelId, 'panel')}:${safeControlId(controlId, 'control')}:${destination}`
}

function normalizeState(raw: unknown): TouchControlStateDefaults | undefined {
  const value = recordOf(raw)
  if (!value) return undefined
  const state: TouchControlStateDefaults = {}
  for (const key of ['active', 'pressed', 'disabled', 'warning'] as const) {
    if (typeof value[key] === 'boolean') state[key] = value[key] as boolean
  }
  const stateValue = value.value
  if (stateValue === null || typeof stateValue === 'boolean' || typeof stateValue === 'number') state.value = stateValue
  else if (typeof stateValue === 'string') state.value = safeText(stateValue, '', 80)
  return Object.keys(state).length > 0 ? state : undefined
}

function normalizeStateBindings(raw: unknown): TouchControlStateBindings | undefined {
  const value = recordOf(raw)
  if (!value) return undefined
  const bindings: TouchControlStateBindings = {}
  for (const destination of TOUCH_CONTROL_STATE_DESTINATIONS) {
    const binding = recordOf(value[destination])
    if (!binding || binding.source !== 'expression') continue
    if (typeof binding.expressionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.expressionId)) continue
    bindings[destination] = { source: 'expression', expressionId: binding.expressionId }
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined
}
export function validateTouchStateBindings(raw: unknown): string[] {
  if (raw === undefined) return []
  const value = recordOf(raw)
  if (!value) return ['stateBindings must be an object']
  const errors: string[] = []
  for (const [destination, rawBinding] of Object.entries(value)) {
    if (!TOUCH_CONTROL_STATE_DESTINATIONS.includes(destination as TouchControlStateDestination)) {
      errors.push(`stateBindings has unknown destination "${destination}"`)
      continue
    }
    const binding = recordOf(rawBinding)
    if (!binding || binding.source !== 'expression') {
      errors.push(`stateBindings.${destination} must use the expression source`)
      continue
    }
    if (typeof binding.expressionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.expressionId)) {
      errors.push(`stateBindings.${destination}.expressionId is invalid`)
    }
    for (const key of Object.keys(binding)) {
      if (key !== 'source' && key !== 'expressionId') errors.push(`stateBindings.${destination} has unexpected field "${key}"`)
    }
  }
  return errors
}
// ── Factories ───────────────────────────────────────────────────────────────
export function createButtonBoxButton(
  partial: ButtonBoxButtonInput = {},
  paletteIndex = 0,
  options: { legacy?: boolean } = {}
): ButtonBoxButton {
  const swatch = NEON_PALETTE[((paletteIndex % NEON_PALETTE.length) + NEON_PALETTE.length) % NEON_PALETTE.length]
  const material = clampMaterial(partial.material, options.legacy ? LEGACY_KEY_MATERIAL : DEFAULT_KEY_MATERIAL)
  const legacyAction = normalizeAction(partial.action)
  const fallbackId = rid('btn')
  const optionalColor = (value: unknown): string | undefined =>
    typeof value === 'string' && safeColor(value, '') ? value : undefined
  return {
    id: safeControlId(partial.id, fallbackId),
    label: safeText(partial.label, `Button ${paletteIndex + 1}`),
    control: normalizeTouchControl(partial.control, legacyAction, material, Boolean(options.legacy)),
    shape: clampShape(partial.shape, defaultShapeForMaterial(material)),
    state: normalizeState(partial.state),
    stateBindings: normalizeStateBindings(partial.stateBindings),
    material,
    icon: safeIcon(partial.icon),
    bodyColor: safeColor(partial.bodyColor, swatch.body),
    textColor: safeColor(partial.textColor, DEFAULT_BUTTON_TEXT),
    fontSize: clampFontSize(partial.fontSize),
    borderColor: safeColor(partial.borderColor, swatch.border),
    borderWidth: clampBorderWidth(partial.borderWidth ?? 2),
    image: safeImage(partial.image),
    activeColor: optionalColor(partial.activeColor),
    activeTextColor: optionalColor(partial.activeTextColor),
    pressedColor: optionalColor(partial.pressedColor),
    pressedTextColor: optionalColor(partial.pressedTextColor),
    disabledColor: optionalColor(partial.disabledColor),
    disabledTextColor: optionalColor(partial.disabledTextColor),
    warningColor: optionalColor(partial.warningColor),
    warningTextColor: optionalColor(partial.warningTextColor)
  }
}

export type ButtonBoxPanelInit = Omit<Partial<ButtonBoxPanel>, 'buttons' | 'schemaVersion'> & {
  buttons?: ButtonBoxButtonInput[]
}

export function createButtonBoxPanel(partial: ButtonBoxPanelInit = {}): ButtonBoxPanel {
  const columns = clampColumns(partial.columns ?? 3)
  const rows = clampRows(partial.rows ?? 2)
  const now = Date.now()
  const buttons = Array.isArray(partial.buttons)
    ? partial.buttons.map((button, index) => createButtonBoxButton(button, index))
    : Array.from({ length: columns * rows }, (_, index) => createButtonBoxButton({}, index))
  return {
    schemaVersion: TOUCH_PANEL_SCHEMA_VERSION,
    id: safeControlId(partial.id, rid('panel')),
    name: str(partial.name, 'Novo button box'),
    columns,
    rows,
    gap: clampGap(partial.gap ?? 14),
    background: safeColor(partial.background, DEFAULT_PANEL_BG),
    buttons,
    tags: safeTags(partial.tags),
    createdAt: typeof partial.createdAt === 'number' && Number.isFinite(partial.createdAt) ? partial.createdAt : now,
    updatedAt: typeof partial.updatedAt === 'number' && Number.isFinite(partial.updatedAt) ? partial.updatedAt : now,
    hidden: Boolean(partial.hidden)
  }
}
// ── Action normalisation + mapping ────────────────────────────────────────────
const IRACING_COMMAND_GROUP: Record<IracingCommandName, IracingCommand['group']> = {
  'pit:addFuel': 'pit',
  'pit:clearFuel': 'pit',
  'pit:toggleTyreLf': 'pit',
  'pit:toggleTyreRf': 'pit',
  'pit:toggleTyreLr': 'pit',
  'pit:toggleTyreRr': 'pit',
  'pit:fastRepair': 'pit',
  'pit:clearAll': 'pit',
  'camera:next': 'camera',
  'camera:previous': 'camera',
  'blackBox:next': 'blackBox',
  'blackBox:previous': 'blackBox'
}

const APP_ACTION_NAMES: ReadonlyArray<AppActionCommand['name']> = [
  'oled:setActivePage',
  'overlays:toggle',
  'dash:cycleNext',
  'dash:cyclePrev'
]

function optionalTiming(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? clampInt(value, min, max, min) : undefined
}

/** Tolerant migration normalizer; strict save/import validation is exposed separately. */
export function normalizeAction(raw: unknown): ButtonAction {
  const candidate = recordOf(raw)
  if (!candidate) return { kind: 'none' }
  switch (candidate.kind) {
    case 'none':
      return { kind: 'none' }
    case 'iracing': {
      const command = recordOf(candidate.command)
      const name = command?.name
      if (typeof name !== 'string' || !(name in IRACING_COMMAND_GROUP)) return { kind: 'none' }
      const commandName = name as IracingCommandName
      const normalized: IracingCommand = { group: IRACING_COMMAND_GROUP[commandName], name: commandName }
      if (commandName === 'pit:addFuel' && typeof command?.fuelLiters === 'number' && Number.isFinite(command.fuelLiters)) {
        normalized.fuelLiters = Math.max(0, Math.min(999, command.fuelLiters))
      }
      return { kind: 'iracing', command: normalized }
    }
    case 'keyboard': {
      const command = recordOf(candidate.command)
      if (!command) return { kind: 'none' }
      const mode =
        typeof command.mode === 'string' && KEYBOARD_MACRO_MODES.includes(command.mode as KeyboardMacroCommand['mode'])
          ? (command.mode as KeyboardMacroCommand['mode'])
          : 'press'
      const keys = Array.isArray(command.keys)
        ? command.keys
            .filter((key): key is string => typeof key === 'string')
            .map((key) => safeText(key.trim(), '', 40))
            .filter(Boolean)
            .slice(0, mode === 'sequence' ? TOUCH_KEYBOARD_MAX_SEQUENCE_KEYS : TOUCH_KEYBOARD_MAX_KEYS)
        : []
      const normalized: KeyboardMacroCommand = { mode, keys }
      const delayMs = optionalTiming(command.delayMs, 0, 10_000)
      const pressDelayMs = optionalTiming(command.pressDelayMs, 0, 10_000)
      const releaseDelayMs = optionalTiming(command.releaseDelayMs, 0, 10_000)
      const repeatMs = optionalTiming(command.repeatMs, CONTROL_REPEAT_MIN_MS, CONTROL_REPEAT_MAX_MS)
      const repeatCount = optionalTiming(command.repeatCount, 1, 25)
      if (delayMs !== undefined) normalized.delayMs = delayMs
      if (pressDelayMs !== undefined) normalized.pressDelayMs = pressDelayMs
      if (releaseDelayMs !== undefined) normalized.releaseDelayMs = releaseDelayMs
      if (repeatMs !== undefined) normalized.repeatMs = repeatMs
      if (repeatCount !== undefined) normalized.repeatCount = repeatCount
      return { kind: 'keyboard', command: normalized }
    }
    case 'app': {
      const command = recordOf(candidate.command)
      const name = command?.name
      if (typeof name !== 'string' || !APP_ACTION_NAMES.includes(name as AppActionCommand['name'])) return { kind: 'none' }
      const normalized: AppActionCommand = { name: name as AppActionCommand['name'] }
      if (normalized.name === 'oled:setActivePage') {
        normalized.pageIndex = clampInt(command?.pageIndex, 0, 64, 0)
      }
      if (normalized.name === 'overlays:toggle') {
        normalized.overlayId =
          typeof command?.overlayId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(command.overlayId)
            ? command.overlayId
            : 'relative'
      }
      return { kind: 'app', command: normalized }
    }
    default:
      return { kind: 'none' }
  }
}

export function isValidButtonAction(raw: unknown): raw is ButtonAction {
  const action = recordOf(raw)
  if (!action || typeof action.kind !== 'string') return false
  if (action.kind === 'none') return Object.keys(action).every((key) => key === 'kind')
  if (!['iracing', 'keyboard', 'app'].includes(action.kind) || !recordOf(action.command)) return false
  if (!Object.keys(action).every((key) => key === 'kind' || key === 'command')) return false
  const normalized = normalizeAction(raw)
  if (normalized.kind !== action.kind) return false
  if (action.kind === 'iracing') {
    const command = action.command as Record<string, unknown>
    if (
      typeof command.name !== 'string' ||
      !(command.name in IRACING_COMMAND_GROUP) ||
      command.group !== IRACING_COMMAND_GROUP[command.name as IracingCommandName]
    ) return false
    const keys = Object.keys(command)
    if (!keys.every((key) => ['group', 'name', 'fuelLiters'].includes(key))) return false
    if (command.name !== 'pit:addFuel' && command.fuelLiters !== undefined) return false
    return command.fuelLiters === undefined ||
      (typeof command.fuelLiters === 'number' && Number.isFinite(command.fuelLiters) && command.fuelLiters >= 0 && command.fuelLiters <= 999)
  }
  if (action.kind === 'keyboard') {
    const command = action.command as Record<string, unknown>
    const timingRanges: Record<string, [number, number]> = {
      delayMs: [0, 10_000],
      pressDelayMs: [0, 10_000],
      releaseDelayMs: [0, 10_000],
      repeatMs: [CONTROL_REPEAT_MIN_MS, CONTROL_REPEAT_MAX_MS],
      repeatCount: [1, 25]
    }
    if (
      typeof command.mode !== 'string' ||
      !KEYBOARD_MACRO_MODES.includes(command.mode as KeyboardMacroCommand['mode']) ||
      !Array.isArray(command.keys) ||
      command.keys.length > (command.mode === 'sequence' ? TOUCH_KEYBOARD_MAX_SEQUENCE_KEYS : TOUCH_KEYBOARD_MAX_KEYS) ||
      !command.keys.every((key) => typeof key === 'string' && key.trim().length > 0 && key.length <= 40) ||
      !Object.keys(command).every((key) => key === 'mode' || key === 'keys' || key in timingRanges)
    ) return false
    for (const [key, [min, max]] of Object.entries(timingRanges)) {
      const value = command[key]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) return false
    }
    return command.repeatCount === undefined || Number.isInteger(command.repeatCount)
  }
  const command = action.command as Record<string, unknown>
  if (typeof command.name !== 'string' || !APP_ACTION_NAMES.includes(command.name as AppActionCommand['name'])) return false
  switch (command.name) {
    case 'overlays:toggle':
      return Object.keys(command).every((key) => key === 'name' || key === 'overlayId') &&
        (command.overlayId === undefined ||
          (typeof command.overlayId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(command.overlayId)))
    case 'oled:setActivePage':
      return Object.keys(command).every((key) => key === 'name' || key === 'pageIndex') &&
        (command.pageIndex === undefined ||
          (typeof command.pageIndex === 'number' && Number.isInteger(command.pageIndex) && command.pageIndex >= 0 && command.pageIndex <= 64))
    case 'dash:cycleNext':
    case 'dash:cyclePrev':
      return Object.keys(command).every((key) => key === 'name')
    default:
      return false
  }
}
export type TouchActionPhase = 'trigger' | 'begin' | 'end' | 'cancel'

/** The only privileged action channel exposed to a fullscreen Touch renderer. */
export const TOUCH_ACTION_IPC_CHANNEL = 'app:touchpanel:action' as const

export interface TouchSemanticActionRequest {
  action: ButtonAction
  phase: TouchActionPhase
  token: string
  zone: string
}

/** Strict runtime boundary: malformed/coerced actions never reach main-process services. */
export function normalizeTouchSemanticActionRequest(raw: unknown): TouchSemanticActionRequest | null {
  const value = recordOf(raw)
  if (!value || !isValidButtonAction(value.action) || value.action.kind === 'none') return null
  if (!['trigger', 'begin', 'end', 'cancel'].includes(String(value.phase))) return null
  if (typeof value.token !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/.test(value.token)) return null
  if (typeof value.zone !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.zone)) return null

  const request: TouchSemanticActionRequest = {
    action: value.action,
    phase: value.phase as TouchActionPhase,
    token: value.token,
    zone: value.zone
  }
  if (request.action.kind !== 'keyboard') return request.phase === 'trigger' ? request : null
  if (request.action.command.mode === 'hold') return request
  if (request.action.command.mode === 'toggle') {
    return request.phase === 'trigger' || request.phase === 'cancel' ? request : null
  }
  return request.phase === 'trigger' ? request : null
}

export interface ButtonActionIpc {
  channel: typeof TOUCH_ACTION_IPC_CHANNEL
  args: [TouchSemanticActionRequest]
}

export function buttonActionToIpc(action: ButtonAction): ButtonActionIpc | null {
  if (action.kind === 'none') return null
  return {
    channel: TOUCH_ACTION_IPC_CHANNEL,
    args: [{ action, phase: 'trigger', token: 'touch:legacy', zone: 'main' }]
  }
}

/** Map every semantic action through one validated main-process boundary. */
export function buttonActionEventToIpc(
  action: ButtonAction,
  phase: TouchActionPhase,
  token: string,
  zone = 'main'
): ButtonActionIpc | null {
  if (action.kind === 'none') return null
  return {
    channel: TOUCH_ACTION_IPC_CHANNEL,
    args: [{ action, phase, token, zone }]
  }
}
/** Short human label describing what a button is bound to (for the editor). */
export function describeButtonAction(action: ButtonAction): string {
  switch (action.kind) {
    case 'none':
      return 'No action'
    case 'iracing':
      return `iRacing · ${action.command.name}`
    case 'keyboard':
      return `Keyboard - ${action.command.keys.join(' + ') || '(empty)'}`
    case 'app':
      return `App · ${action.command.name}`
    default:
      return 'No action'
  }
}

// ── Versioned migration / parse / serialisation ───────────────────────────────
export interface TouchPanelParseResult {
  panel: ButtonBoxPanel | null
  errors: string[]
  warnings: string[]
  migratedFrom?: number
}

export function normalizeButtonBoxButton(raw: unknown, index = 0, legacy = true): ButtonBoxButton {
  const value = recordOf(raw)
  if (!value) return createButtonBoxButton({ label: '' }, index, { legacy })
  const input = value as ButtonBoxButtonInput
  const material = clampMaterial(input.material, legacy ? LEGACY_KEY_MATERIAL : DEFAULT_KEY_MATERIAL)
  return createButtonBoxButton({ ...input, material }, index, { legacy })
}

function parsePanelInput(raw: unknown): { value: Record<string, unknown> | null; error?: string } {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { value: null, error: 'Panel JSON is malformed.' }
    }
  }
  const object = recordOf(value)
  return object ? { value: object } : { value: null, error: 'Panel payload must be an object.' }
}

function legacyButtonActions(rawButton: unknown): Array<{ path: string; action: unknown }> {
  const button = recordOf(rawButton)
  if (!button) return []
  const actions: Array<{ path: string; action: unknown }> = []
  if (button.action !== undefined) actions.push({ path: 'action', action: button.action })
  const control = recordOf(button.control)
  if (!control || typeof control.kind !== 'string') return actions
  const add = (path: string, action: unknown): void => {
    if (action !== undefined) actions.push({ path, action })
  }
  switch (control.kind) {
    case 'momentary':
    case 'guarded-two-step':
      add('control.action', control.action)
      break
    case 'latching-toggle':
      add('control.onAction', control.onAction)
      add('control.offAction', control.offAction)
      break
    case 'two-position-rocker':
      add('control.negativeAction', control.negativeAction)
      add('control.positiveAction', control.positiveAction)
      break
    case 'rotary':
      add('control.decrementAction', control.decrementAction)
      add('control.incrementAction', control.incrementAction)
      break
    case 'selector':
      if (Array.isArray(control.choices)) {
        control.choices.forEach((choice, index) => add(`control.choices[${index}].action`, recordOf(choice)?.action))
      }
      break
  }
  return actions
}

function legacyKeyboardMigrationErrors(rawButton: unknown, buttonIndex: number): string[] {
  const errors: string[] = []
  for (const entry of legacyButtonActions(rawButton)) {
    const action = recordOf(entry.action)
    if (action?.kind !== 'keyboard') continue
    const command = recordOf(action.command)
    const mode = command?.mode
    const keys = command?.keys
    const prefix = `Button ${buttonIndex + 1} ${entry.path}`
    if (typeof mode !== 'string' || !KEYBOARD_MACRO_MODES.includes(mode as KeyboardMacroCommand['mode'])) {
      errors.push(`${prefix} has an invalid keyboard mode; migration aborted without changing the action.`)
      continue
    }
    if (!Array.isArray(keys)) {
      errors.push(`${prefix} has no keyboard key list; migration aborted without changing the action.`)
      continue
    }
    if (!keys.every((key) => typeof key === 'string' && key.trim().length > 0 && key.length <= 40)) {
      errors.push(`${prefix} contains an invalid or overlong key; migration aborted without dropping keys.`)
      continue
    }
    const limit = mode === 'sequence' ? TOUCH_KEYBOARD_MAX_SEQUENCE_KEYS : TOUCH_KEYBOARD_MAX_KEYS
    if (keys.length > limit) {
      errors.push(`${prefix} contains ${keys.length} keys (maximum ${limit}); migration aborted without truncation.`)
    }
  }
  return errors
}
export function parseButtonBoxPanelDetailed(raw: unknown): TouchPanelParseResult {
  const decoded = parsePanelInput(raw)
  if (!decoded.value) return { panel: null, errors: [decoded.error ?? 'Invalid panel.'], warnings: [] }
  const value = decoded.value
  const errors: string[] = []
  const warnings: string[] = []
  const rawVersion = value.schemaVersion
  const legacy = rawVersion === undefined || rawVersion === 1
  if (!legacy && rawVersion !== TOUCH_PANEL_SCHEMA_VERSION) {
    return {
      panel: null,
      errors: [`Unsupported touch panel schema version: ${String(rawVersion)}.`],
      warnings: []
    }
  }
  if (typeof value.id !== 'string' || !value.id) errors.push('Panel id is required.')
  else if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.id)) errors.push('Panel id contains unsupported characters.')

  const columns = clampColumns(value.columns)
  let rows = clampRows(value.rows)
  const rawButtons = Array.isArray(value.buttons) ? value.buttons : []
  if (legacy) {
    rawButtons.forEach((button, index) => errors.push(...legacyKeyboardMigrationErrors(button, index)))
  } else {
    rawButtons.forEach((button, index) => {
      const object = recordOf(button)
      if (!object) errors.push(`Button ${index + 1} must be an object.`)
      else {
        for (const error of validateTouchControl(object.control)) errors.push(`Button ${index + 1}: ${error}`)
        for (const error of validateTouchStateBindings(object.stateBindings)) errors.push(`Button ${index + 1}: ${error}`)
      }
    })
  }

  let buttons = rawButtons.map((button, index) => normalizeButtonBoxButton(button, index, legacy))
  const seenIds = new Set<string>()
  buttons = buttons.map((button, index) => {
    if (!seenIds.has(button.id)) {
      seenIds.add(button.id)
      return button
    }
    warnings.push(`Button ${index + 1} had a duplicate id and received a new id.`)
    const replacement = { ...button, id: rid('btn') }
    seenIds.add(replacement.id)
    return replacement
  })

  let capacity = columns * rows
  if (legacy) {
    if (buttons.length > capacity) {
      const requiredRows = Math.ceil(buttons.length / columns)
      if (requiredRows <= PANEL_MAX_ROWS) {
        rows = requiredRows
        capacity = columns * rows
        warnings.push(`Legacy grid expanded to ${rows} rows to preserve every control.`)
      } else {
        errors.push(`Legacy panel has ${buttons.length} controls but the maximum grid capacity is ${columns * PANEL_MAX_ROWS}.`)
      }
    }
    if (buttons.length < capacity) {
      buttons = resizePanelButtons(buttons, capacity)
      warnings.push('Legacy grid was padded with safe empty controls.')
    }
  } else if (buttons.length !== capacity) {
    errors.push(`Grid must contain exactly ${capacity} controls; received ${buttons.length}.`)
  }

  if (errors.length > 0) return { panel: null, errors, warnings, migratedFrom: legacy ? 1 : undefined }
  const panel: ButtonBoxPanel = {
    schemaVersion: TOUCH_PANEL_SCHEMA_VERSION,
    id: value.id as string,
    name: str(value.name, 'Button box'),
    columns,
    rows,
    gap: clampGap(value.gap),
    background: safeColor(value.background, DEFAULT_PANEL_BG),
    buttons,
    tags: safeTags(value.tags),
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : undefined,
    hidden: Boolean(value.hidden)
  }
  return { panel, errors: [], warnings, migratedFrom: legacy ? 1 : undefined }
}

export function parseButtonBoxPanel(raw: unknown): ButtonBoxPanel | null {
  return parseButtonBoxPanelDetailed(raw).panel
}

export function validateButtonBoxPanel(panel: unknown): string[] {
  return parseButtonBoxPanelDetailed(panel).errors
}

export function serializeButtonBoxPanel(panel: ButtonBoxPanel): string {
  const result = parseButtonBoxPanelDetailed(panel)
  if (!result.panel) throw new Error(result.errors.join(' '))
  return JSON.stringify(result.panel, null, 2)
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
