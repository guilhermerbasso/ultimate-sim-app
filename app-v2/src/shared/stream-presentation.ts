import type { Dashboard, DashboardSummary } from './dashboards'
import type { ButtonBoxPanel, ButtonBoxSummary } from './touch-panel'
import type { StreamingLayoutKind } from './streaming'

export const STREAM_PRESENTATION_SCHEMA_VERSION = 1 as const
export const STREAM_PRESENTATION_STORE_VERSION = 1 as const

export const STREAM_PRESENTATION_CHANNELS = {
  list: 'streaming:presentation:list',
  get: 'streaming:presentation:get',
  save: 'streaming:presentation:save',
  delete: 'streaming:presentation:delete',
  targets: 'streaming:presentation:targets',
  refreshTarget: 'streaming:presentation:refresh-target'
} as const

export const STREAM_PRESENTATION_CONFLICT = 'STREAM_PRESENTATION_CONFLICT'
export const STREAM_PRESENTATION_TARGET_CHANGED = 'STREAM_PRESENTATION_TARGET_CHANGED'
export const STREAM_PRESENTATION_TARGET_MISSING = 'STREAM_PRESENTATION_TARGET_MISSING'

export type StreamPresentationOrientation = 'portrait' | 'landscape'
export type StreamPresentationFitMode = 'fit' | 'fill'
export type StreamPresentationPlatform = 'ios' | 'android'
export type StreamPresentationFormFactor = 'phone' | 'tablet'
export type StreamPresentationTargetState = 'current' | 'stale' | 'missing'

export interface StreamSafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface StreamPresentationViewport {
  /** Canonical portrait width in CSS pixels. */
  width: number
  /** Canonical portrait height in CSS pixels. */
  height: number
}

export interface StreamDevicePreset {
  id: string
  label: string
  platform: StreamPresentationPlatform
  formFactor: StreamPresentationFormFactor
  viewport: StreamPresentationViewport
  safeArea: StreamSafeAreaInsets
  minimumTouchTarget: number
}

export interface StreamVisibilityOverride {
  elementId: string
  visible: boolean
}

export interface StreamPresentationBreakpoint {
  id: string
  name: string
  minWidth?: number
  maxWidth?: number
  orientation?: StreamPresentationOrientation
  fitMode?: StreamPresentationFitMode
  minimumTouchTarget?: number
  visibilityOverrides?: StreamVisibilityOverride[]
}

export interface StreamPresentationSettings {
  devicePresetId: string
  viewport: StreamPresentationViewport
  orientation: StreamPresentationOrientation
  safeArea: StreamSafeAreaInsets
  fitMode: StreamPresentationFitMode
  minimumTouchTarget: number
  breakpoints: StreamPresentationBreakpoint[]
  visibilityOverrides: StreamVisibilityOverride[]
}

export interface StreamPresentationTargetRef {
  kind: StreamingLayoutKind
  id: string
  revision: string
}

export interface StreamPresentationProfile {
  schemaVersion: typeof STREAM_PRESENTATION_SCHEMA_VERSION
  id: string
  name: string
  target: StreamPresentationTargetRef
  settings: StreamPresentationSettings
  revision: number
  createdAt: number
  updatedAt: number
}

export interface StreamPresentationStorePayload {
  version: typeof STREAM_PRESENTATION_STORE_VERSION
  profiles: StreamPresentationProfile[]
}

export interface StreamPresentationTargetDescriptor {
  kind: StreamingLayoutKind
  id: string
  name: string
  revision: string
  width?: number
  height?: number
  itemCount: number
  hidden: boolean
}

export interface StreamPresentationProfileListItem {
  profile: StreamPresentationProfile
  target: StreamPresentationTargetDescriptor | null
  targetState: StreamPresentationTargetState
}

export interface StreamPresentationSaveRequest {
  profile: StreamPresentationProfile
  expectedRevision: number | null
}

export interface StreamPresentationDeleteRequest {
  id: string
  expectedRevision: number
}

export interface StreamPresentationRefreshTargetRequest {
  id: string
  expectedRevision: number
}

export interface ResolvedStreamPresentation {
  viewport: { width: number; height: number }
  safeArea: StreamSafeAreaInsets
  content: { width: number; height: number }
  fitMode: StreamPresentationFitMode
  minimumTouchTarget: number
  hiddenElementIds: ReadonlySet<string>
  activeBreakpointId: string | null
  signature: string
}

export interface ResolvedTouchPresentationLayout {
  width: number
  height: number
  scale: number
  left: number
  top: number
}

const ZERO_SAFE_AREA: StreamSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }
const MIN_VIEWPORT = 240
const MAX_VIEWPORT = 4096
const MIN_TOUCH_TARGET = 44
const MAX_TOUCH_TARGET = 128
const MAX_BREAKPOINTS = 32
const MAX_VISIBILITY_OVERRIDES = 2_048

export const STREAM_DEVICE_PRESETS: readonly StreamDevicePreset[] = [
  {
    id: 'ipad-11',
    label: 'iPad 11-inch',
    platform: 'ios',
    formFactor: 'tablet',
    viewport: { width: 834, height: 1194 },
    safeArea: { top: 24, right: 0, bottom: 20, left: 0 },
    minimumTouchTarget: 44
  },
  {
    id: 'iphone-15-pro',
    label: 'iPhone 15 Pro',
    platform: 'ios',
    formFactor: 'phone',
    viewport: { width: 393, height: 852 },
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
    minimumTouchTarget: 44
  },
  {
    id: 'android-phone',
    label: 'Android phone',
    platform: 'android',
    formFactor: 'phone',
    viewport: { width: 412, height: 915 },
    safeArea: { top: 24, right: 0, bottom: 24, left: 0 },
    minimumTouchTarget: 48
  },
  {
    id: 'android-tablet',
    label: 'Android tablet',
    platform: 'android',
    formFactor: 'tablet',
    viewport: { width: 800, height: 1280 },
    safeArea: { top: 24, right: 0, bottom: 24, left: 0 },
    minimumTouchTarget: 48
  }
] as const

export const DEFAULT_STREAM_DEVICE_PRESET_ID = STREAM_DEVICE_PRESETS[0].id

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function safeTimestamp(value: unknown, fallback: number): number {
  return finiteInteger(value, fallback, 0, Number.MAX_SAFE_INTEGER)
}

function safeId(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return /^[A-Za-z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : fallback
}

function safeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed ? trimmed.slice(0, 120) : fallback
}

export function streamDevicePreset(id: string | undefined): StreamDevicePreset {
  return STREAM_DEVICE_PRESETS.find((preset) => preset.id === id) ?? STREAM_DEVICE_PRESETS[0]
}

export function normalizeStreamViewport(
  value: Partial<StreamPresentationViewport> | null | undefined,
  fallback: StreamPresentationViewport = streamDevicePreset(DEFAULT_STREAM_DEVICE_PRESET_ID).viewport
): StreamPresentationViewport {
  const first = finiteInteger(value?.width, fallback.width, MIN_VIEWPORT, MAX_VIEWPORT)
  const second = finiteInteger(value?.height, fallback.height, MIN_VIEWPORT, MAX_VIEWPORT)
  return {
    width: Math.min(first, second),
    height: Math.max(first, second)
  }
}

export function normalizeStreamSafeArea(
  value: Partial<StreamSafeAreaInsets> | null | undefined,
  fallback: StreamSafeAreaInsets = ZERO_SAFE_AREA
): StreamSafeAreaInsets {
  return {
    top: finiteInteger(value?.top, fallback.top, 0, MAX_VIEWPORT),
    right: finiteInteger(value?.right, fallback.right, 0, MAX_VIEWPORT),
    bottom: finiteInteger(value?.bottom, fallback.bottom, 0, MAX_VIEWPORT),
    left: finiteInteger(value?.left, fallback.left, 0, MAX_VIEWPORT)
  }
}

export function rotateStreamSafeArea(
  insets: StreamSafeAreaInsets,
  orientation: StreamPresentationOrientation
): StreamSafeAreaInsets {
  if (orientation === 'portrait') return { ...insets }
  return {
    top: insets.left,
    right: insets.top,
    bottom: insets.right,
    left: insets.bottom
  }
}

export function resolveStreamViewport(
  viewport: StreamPresentationViewport,
  orientation: StreamPresentationOrientation
): { width: number; height: number } {
  return orientation === 'portrait'
    ? { width: viewport.width, height: viewport.height }
    : { width: viewport.height, height: viewport.width }
}

export function streamMinimumTouchTarget(
  requested: number,
  presetId: string | undefined
): number {
  const preset = streamDevicePreset(presetId)
  return finiteInteger(requested, preset.minimumTouchTarget, preset.minimumTouchTarget, MAX_TOUCH_TARGET)
}

function normalizeVisibilityOverrides(value: unknown): StreamVisibilityOverride[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, StreamVisibilityOverride>()
  for (const candidate of value.slice(0, MAX_VISIBILITY_OVERRIDES)) {
    if (!isRecord(candidate)) continue
    const elementId = safeId(candidate.elementId)
    if (!elementId) continue
    byId.set(elementId, { elementId, visible: candidate.visible !== false })
  }
  return [...byId.values()]
}

function normalizeBreakpoint(value: unknown, index: number): StreamPresentationBreakpoint | null {
  if (!isRecord(value)) return null
  const id = safeId(value.id, `breakpoint-${index + 1}`)
  if (!id) return null
  const minWidth = value.minWidth === undefined
    ? undefined
    : finiteInteger(value.minWidth, MIN_VIEWPORT, MIN_VIEWPORT, MAX_VIEWPORT)
  const maxWidth = value.maxWidth === undefined
    ? undefined
    : finiteInteger(value.maxWidth, MAX_VIEWPORT, MIN_VIEWPORT, MAX_VIEWPORT)
  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) return null
  const orientation = value.orientation === 'portrait' || value.orientation === 'landscape'
    ? value.orientation
    : undefined
  const fitMode = value.fitMode === 'fill' || value.fitMode === 'fit' ? value.fitMode : undefined
  const minimumTouchTarget = value.minimumTouchTarget === undefined
    ? undefined
    : finiteInteger(value.minimumTouchTarget, MIN_TOUCH_TARGET, MIN_TOUCH_TARGET, MAX_TOUCH_TARGET)
  return {
    id,
    name: safeName(value.name, `Breakpoint ${index + 1}`),
    ...(minWidth === undefined ? {} : { minWidth }),
    ...(maxWidth === undefined ? {} : { maxWidth }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(fitMode === undefined ? {} : { fitMode }),
    ...(minimumTouchTarget === undefined ? {} : { minimumTouchTarget }),
    visibilityOverrides: normalizeVisibilityOverrides(value.visibilityOverrides)
  }
}

export function normalizeStreamPresentationSettings(
  value: Partial<StreamPresentationSettings> | null | undefined
): StreamPresentationSettings {
  const preset = streamDevicePreset(value?.devicePresetId)
  const orientation: StreamPresentationOrientation = value?.orientation === 'landscape' ? 'landscape' : 'portrait'
  const breakpoints = Array.isArray(value?.breakpoints)
    ? value.breakpoints
        .slice(0, MAX_BREAKPOINTS)
        .map(normalizeBreakpoint)
        .filter((item): item is StreamPresentationBreakpoint => item !== null)
    : []
  return {
    devicePresetId: preset.id,
    viewport: normalizeStreamViewport(value?.viewport, preset.viewport),
    orientation,
    safeArea: normalizeStreamSafeArea(value?.safeArea, preset.safeArea),
    fitMode: value?.fitMode === 'fill' ? 'fill' : 'fit',
    minimumTouchTarget: streamMinimumTouchTarget(value?.minimumTouchTarget ?? preset.minimumTouchTarget, preset.id),
    breakpoints,
    visibilityOverrides: normalizeVisibilityOverrides(value?.visibilityOverrides)
  }
}

export function createStreamPresentationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return `stream-profile-${randomUuid}`
  return `stream-profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createStreamPresentationProfile(
  target: StreamPresentationTargetDescriptor,
  options: {
    id?: string
    name?: string
    presetId?: string
    now?: number
  } = {}
): StreamPresentationProfile {
  const now = safeTimestamp(options.now, Date.now())
  const preset = streamDevicePreset(options.presetId)
  return {
    schemaVersion: STREAM_PRESENTATION_SCHEMA_VERSION,
    id: safeId(options.id, createStreamPresentationId()),
    name: safeName(options.name, `${target.name} · ${preset.label}`),
    target: { kind: target.kind, id: target.id, revision: target.revision },
    settings: normalizeStreamPresentationSettings({
      devicePresetId: preset.id,
      viewport: preset.viewport,
      safeArea: preset.safeArea,
      minimumTouchTarget: preset.minimumTouchTarget
    }),
    revision: 0,
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeStreamPresentationProfile(
  value: unknown,
  now = Date.now()
): StreamPresentationProfile | null {
  if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.settings)) return null
  const id = safeId(value.id)
  const targetId = safeId(value.target.id)
  const targetRevision = typeof value.target.revision === 'string' ? value.target.revision.trim().slice(0, 256) : ''
  if (!id || !targetId || !targetRevision) return null
  const kind: StreamingLayoutKind = value.target.kind === 'touch' ? 'touch' : value.target.kind === 'dashboard' ? 'dashboard' : 'dashboard'
  if (value.target.kind !== kind) return null
  const createdAt = safeTimestamp(value.createdAt, now)
  const updatedAt = Math.max(createdAt, safeTimestamp(value.updatedAt, createdAt))
  return {
    schemaVersion: STREAM_PRESENTATION_SCHEMA_VERSION,
    id,
    name: safeName(value.name, 'Mobile stream profile'),
    target: { kind, id: targetId, revision: targetRevision },
    settings: normalizeStreamPresentationSettings(value.settings as Partial<StreamPresentationSettings>),
    revision: finiteInteger(value.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    createdAt,
    updatedAt
  }
}

export function normalizeStreamPresentationStore(value: unknown): StreamPresentationStorePayload {
  if (!isRecord(value) || !Array.isArray(value.profiles)) {
    return { version: STREAM_PRESENTATION_STORE_VERSION, profiles: [] }
  }
  const byId = new Map<string, StreamPresentationProfile>()
  for (const raw of value.profiles.slice(0, 512)) {
    const profile = normalizeStreamPresentationProfile(raw)
    if (profile) byId.set(profile.id, profile)
  }
  return {
    version: STREAM_PRESENTATION_STORE_VERSION,
    profiles: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
  }
}

export function cloneStreamPresentationProfile(profile: StreamPresentationProfile): StreamPresentationProfile {
  return structuredClone(profile)
}

export function streamDashboardTargetRevision(
  dashboard: Pick<DashboardSummary, 'storageEpoch' | 'storageRevision' | 'updatedAt' | 'createdAt' | 'width' | 'height' | 'elementCount'>
): string {
  if (dashboard.storageEpoch && dashboard.storageRevision) {
    return `dashboard:${dashboard.storageEpoch}:${dashboard.storageRevision}`
  }
  return `dashboard:${dashboard.updatedAt ?? dashboard.createdAt ?? 0}:${dashboard.width}x${dashboard.height}:${dashboard.elementCount}`
}

export function streamTouchTargetRevision(
  panel: Pick<ButtonBoxSummary, 'updatedAt' | 'columns' | 'rows' | 'buttonCount'>
): string {
  return `touch:${panel.updatedAt ?? 0}:${panel.columns}x${panel.rows}:${panel.buttonCount}`
}

export function streamDashboardTargetDescriptor(
  dashboard: DashboardSummary
): StreamPresentationTargetDescriptor {
  return {
    kind: 'dashboard',
    id: dashboard.id,
    name: dashboard.name,
    revision: streamDashboardTargetRevision(dashboard),
    width: dashboard.width,
    height: dashboard.height,
    itemCount: dashboard.elementCount,
    hidden: Boolean(dashboard.hidden)
  }
}

export function streamTouchTargetDescriptor(
  panel: ButtonBoxSummary
): StreamPresentationTargetDescriptor {
  return {
    kind: 'touch',
    id: panel.id,
    name: panel.name,
    revision: streamTouchTargetRevision(panel),
    itemCount: panel.buttonCount,
    hidden: Boolean(panel.hidden)
  }
}

export function streamPresentationTargetState(
  profile: StreamPresentationProfile,
  target: StreamPresentationTargetDescriptor | null
): StreamPresentationTargetState {
  if (!target || target.id !== profile.target.id || target.kind !== profile.target.kind) return 'missing'
  return target.revision === profile.target.revision ? 'current' : 'stale'
}

export function refreshStreamPresentationTarget(
  profile: StreamPresentationProfile,
  target: StreamPresentationTargetDescriptor,
  now = Date.now()
): StreamPresentationProfile {
  if (target.id !== profile.target.id || target.kind !== profile.target.kind) {
    throw new Error(`${STREAM_PRESENTATION_TARGET_MISSING}: target ${profile.target.kind}:${profile.target.id} is unavailable`)
  }
  return {
    ...cloneStreamPresentationProfile(profile),
    target: { kind: target.kind, id: target.id, revision: target.revision },
    updatedAt: safeTimestamp(now, Date.now())
  }
}

function breakpointMatches(
  breakpoint: StreamPresentationBreakpoint,
  width: number,
  orientation: StreamPresentationOrientation
): boolean {
  if (breakpoint.orientation && breakpoint.orientation !== orientation) return false
  if (breakpoint.minWidth !== undefined && width < breakpoint.minWidth) return false
  if (breakpoint.maxWidth !== undefined && width > breakpoint.maxWidth) return false
  return true
}

function resolveVisibility(
  base: readonly StreamVisibilityOverride[],
  breakpoint: readonly StreamVisibilityOverride[]
): ReadonlySet<string> {
  const visibility = new Map<string, boolean>()
  for (const item of [...base, ...breakpoint]) visibility.set(item.elementId, item.visible)
  return new Set([...visibility].filter(([, visible]) => !visible).map(([id]) => id))
}

export function resolveStreamPresentation(
  profile: StreamPresentationProfile
): ResolvedStreamPresentation {
  const settings = normalizeStreamPresentationSettings(profile.settings)
  const viewport = resolveStreamViewport(settings.viewport, settings.orientation)
  const rotatedSafeArea = rotateStreamSafeArea(settings.safeArea, settings.orientation)
  const safeArea = {
    top: Math.min(rotatedSafeArea.top, Math.max(0, viewport.height - 1)),
    right: Math.min(rotatedSafeArea.right, Math.max(0, viewport.width - 1)),
    bottom: Math.min(rotatedSafeArea.bottom, Math.max(0, viewport.height - rotatedSafeArea.top - 1)),
    left: Math.min(rotatedSafeArea.left, Math.max(0, viewport.width - rotatedSafeArea.right - 1))
  }
  const content = {
    width: Math.max(1, viewport.width - safeArea.left - safeArea.right),
    height: Math.max(1, viewport.height - safeArea.top - safeArea.bottom)
  }
  const activeBreakpoint = settings.breakpoints.find((candidate) =>
    breakpointMatches(candidate, content.width, settings.orientation)
  ) ?? null
  const fitMode = activeBreakpoint?.fitMode ?? settings.fitMode
  const minimumTouchTarget = streamMinimumTouchTarget(
    activeBreakpoint?.minimumTouchTarget ?? settings.minimumTouchTarget,
    settings.devicePresetId
  )
  const hiddenElementIds = resolveVisibility(
    settings.visibilityOverrides,
    activeBreakpoint?.visibilityOverrides ?? []
  )
  const signature = JSON.stringify({
    profile: profile.id,
    target: profile.target,
    viewport,
    safeArea,
    content,
    fitMode,
    minimumTouchTarget,
    hidden: [...hiddenElementIds].sort(),
    breakpoint: activeBreakpoint?.id ?? null
  })
  return {
    viewport,
    safeArea,
    content,
    fitMode,
    minimumTouchTarget,
    hiddenElementIds,
    activeBreakpointId: activeBreakpoint?.id ?? null,
    signature
  }
}

export function dashboardForStreamPresentation(
  dashboard: Dashboard,
  resolved: ResolvedStreamPresentation
): Dashboard {
  return {
    ...dashboard,
    scaleMode: resolved.fitMode,
    elements: dashboard.elements.filter((element) => !resolved.hiddenElementIds.has(element.id))
  }
}

export function resolveTouchPresentationLayout(
  panel: ButtonBoxPanel,
  resolved: ResolvedStreamPresentation
): ResolvedTouchPresentationLayout {
  const columns = Math.max(1, panel.columns)
  const rows = Math.max(1, panel.rows, Math.ceil(panel.buttons.length / columns))
  const gap = Math.max(0, panel.gap)
  const width = columns * resolved.minimumTouchTarget + (columns + 1) * gap
  const height = rows * resolved.minimumTouchTarget + (rows + 1) * gap
  const fitScale = Math.min(resolved.content.width / width, resolved.content.height / height)
  const fillScale = Math.max(resolved.content.width / width, resolved.content.height / height)
  // Never shrink below the configured physical target size. If a panel cannot fit,
  // the safe-area viewport clips it instead of silently creating undersized controls.
  const scale = Math.max(1, resolved.fitMode === 'fill' ? fillScale : fitScale)
  return {
    width,
    height,
    scale,
    left: Math.floor((resolved.content.width - width * scale) / 2),
    top: Math.floor((resolved.content.height - height * scale) / 2)
  }
}

export function touchPanelForStreamPresentation(
  panel: ButtonBoxPanel
): ButtonBoxPanel {
  return panel
}
