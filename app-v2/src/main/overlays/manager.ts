import { BrowserWindow, screen, shell, type Display, type WebContents } from 'electron'
import { devRendererOrigin, devRendererUrl } from '../dev-renderer'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type {
  CustomOverlayDef,
  CustomOverlayElement,
  CustomOverlayListItem,
  OverlayDisplayInfo,
  OverlayDisplayRef,
  OverlayGestureMode,
  OverlayGestureState,
  OverlayListItem,
  OverlayPointer,
  OverlayPosition,
  OverlayWidgetStyle,
  OverlaysConfig,
  OverlayWidgetConfig,
  OverlayWidgetId
} from '../../shared/overlays'
import {
  createDefaultOverlayStyle,
  createDefaultOverlaysConfig,
  CUSTOM_OVERLAY_ID_PREFIX,
  DEFAULT_CUSTOM_OVERLAY_POSITION,
  defaultTriggerForHifiModule,
  getOverlayStylePreset,
  hifiModuleRole,
  isCustomOverlayId,
  OVERLAY_WIDGETS,
  sanitizeCustomOverlayWidgets,
  sanitizeOverlayTrigger,
  sanitizeOverlayTriggerForRole
} from '../../shared/overlays'
import {
  OVERLAY_EDITOR_PREVIEW_CHANNELS,
  type OverlayEditorPreviewState
} from '../../shared/overlay-editor-preview'
import type { ModuleContext } from '../module-context'
import { fixIracingFullscreen, readIracingGraphicsStatus } from './iracing-graphics'
import { logger } from '../modules/logger'


function openExternalUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') void shell.openExternal(parsed.toString())
  } catch {
    // Deny malformed URLs.
  }
}

function isAllowedAppNavigation(url: string): boolean {
  try {
    const parsed = new URL(url)
    const devOrigin = devRendererOrigin()
    if (devOrigin) {
      return parsed.origin === devOrigin
    }
    const appHtml = pathToFileURL(join(__dirname, '../renderer/overlay.html'))
    return parsed.protocol === 'file:' && parsed.pathname === appHtml.pathname
  } catch {
    return false
  }
}

const CONFIG_FILE = 'overlays.json'

function bindEditorPreviewOwnerLifecycle(
  win: BrowserWindow,
  release: (owner: WebContents) => void
): () => void {
  const owner = win.webContents
  const releaseOwner = (): void => release(owner)
  const onDidStartNavigation = (
    _event: Electron.Event,
    _url: string,
    _isInPlace: boolean,
    isMainFrame: boolean
  ): void => {
    if (isMainFrame !== false) releaseOwner()
  }

  win.on('hide', releaseOwner)
  win.on('closed', releaseOwner)
  owner.on('did-start-navigation', onDidStartNavigation)
  owner.on('render-process-gone', releaseOwner)
  owner.on('destroyed', releaseOwner)

  return () => {
    win.removeListener('hide', releaseOwner)
    win.removeListener('closed', releaseOwner)
    owner.removeListener('did-start-navigation', onDidStartNavigation)
    owner.removeListener('render-process-gone', releaseOwner)
    owner.removeListener('destroyed', releaseOwner)
  }
}

function isHifiWidgetId(value: unknown): value is `hifi:${string}` {
  return typeof value === 'string' && value.startsWith('hifi:') && value.length > 5
}

function isWidgetId(value: unknown): value is OverlayWidgetId {
  return typeof value === 'string' && (OVERLAY_WIDGETS.some((widget) => widget.id === value) || isHifiWidgetId(value))
}

function sanitizePosition(position: unknown): OverlayPosition {
  const p = isPlainObject(position) ? position : {}
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    x: Math.round(num(p.x, 0)),
    y: Math.round(num(p.y, 0)),
    width: Math.max(160, Math.round(num(p.width, 260))),
    height: Math.max(70, Math.round(num(p.height, 120)))
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function nearestDisplayForPosition(position: OverlayPosition, displays: Display[]): Display | null {
  if (displays.length === 0) return null
  const cx = position.x + position.width / 2
  const cy = position.y + position.height / 2
  return displays.reduce((best, display) => {
    const bx = best.workArea.x + best.workArea.width / 2
    const by = best.workArea.y + best.workArea.height / 2
    const dx = display.workArea.x + display.workArea.width / 2
    const dy = display.workArea.y + display.workArea.height / 2
    return (dx - cx) ** 2 + (dy - cy) ** 2 < (bx - cx) ** 2 + (by - cy) ** 2 ? display : best
  })
}

function displayRefFor(display: Display, index: number): OverlayDisplayRef {
  return {
    id: display.id,
    index,
    bounds: sanitizePosition(display.bounds),
    workArea: sanitizePosition(display.workArea)
  }
}

function displayLabel(display: Display, index: number, primaryId: number): string {
  const suffix = display.id === primaryId ? ' (primary)' : ''
  return `${index + 1} — ${display.bounds.width}×${display.bounds.height}${suffix}`
}

function sanitizeDisplayRef(value: unknown): OverlayDisplayRef | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as Partial<OverlayDisplayRef>
  const id = typeof ref.id === 'number' && Number.isFinite(ref.id) ? Math.round(ref.id) : null
  const index = typeof ref.index === 'number' && Number.isFinite(ref.index) ? Math.max(0, Math.round(ref.index)) : 0
  if (id === null) return null
  return {
    id,
    index,
    bounds: sanitizePosition(ref.bounds ?? { x: 0, y: 0, width: 1, height: 1 }),
    workArea: sanitizePosition(ref.workArea ?? ref.bounds ?? { x: 0, y: 0, width: 1, height: 1 })
  }
}

function displaysOverlap(a: OverlayPosition, b: OverlayPosition): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function resolveDisplay(ref: OverlayDisplayRef | null | undefined, position: OverlayPosition): Display {
  const displays = screen.getAllDisplays()
  if (ref) {
    const byId = displays.find((display) => display.id === ref.id)
    if (byId) return byId
    const byIndex = displays[ref.index]
    if (byIndex && displaysOverlap(byIndex.bounds, ref.bounds)) return byIndex
    const bySavedBounds = displays.find((display) => displaysOverlap(display.bounds, ref.bounds))
    if (bySavedBounds) return bySavedBounds
  }
  return screen.getDisplayMatching(position) ?? nearestDisplayForPosition(position, displays) ?? screen.getPrimaryDisplay()
}

function displayForPosition(position: OverlayPosition): { display: Display; index: number } {
  const sanitized = sanitizePosition(position)
  const displays = screen.getAllDisplays()
  const display = screen.getDisplayMatching(sanitized) ?? nearestDisplayForPosition(sanitized, displays) ?? screen.getPrimaryDisplay()
  return { display, index: Math.max(0, displays.findIndex((item) => item.id === display.id)) }
}

function virtualWorkArea(): OverlayPosition {
  const displays = screen.getAllDisplays()
  const areas = displays.length > 0 ? displays.map((display) => display.workArea) : [screen.getPrimaryDisplay().workArea]
  const minX = Math.min(...areas.map((area) => area.x))
  const minY = Math.min(...areas.map((area) => area.y))
  const maxX = Math.max(...areas.map((area) => area.x + area.width))
  const maxY = Math.max(...areas.map((area) => area.y + area.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function clampPositionToDisplay(position: OverlayPosition, display: Display): OverlayPosition {
  const sanitized = sanitizePosition(position)
  const area = display.workArea
  const width = Math.min(sanitized.width, area.width)
  const height = Math.min(sanitized.height, area.height)
  return {
    x: clamp(sanitized.x, area.x, area.x + area.width - width),
    y: clamp(sanitized.y, area.y, area.y + area.height - height),
    width,
    height
  }
}

function clampPositionToVirtualWorkArea(position: OverlayPosition): OverlayPosition {
  const sanitized = sanitizePosition(position)
  const area = virtualWorkArea()
  const width = Math.min(sanitized.width, area.width)
  const height = Math.min(sanitized.height, area.height)
  return {
    x: clamp(sanitized.x, area.x, area.x + area.width - width),
    y: clamp(sanitized.y, area.y, area.y + area.height - height),
    width,
    height
  }
}

function clampPositionToDisplays(position: OverlayPosition, ref?: OverlayDisplayRef | null): OverlayPosition {
  const sanitized = sanitizePosition(position)
  return clampPositionToDisplay(sanitized, resolveDisplay(ref, sanitized))
}

function translatePositionToDisplay(position: OverlayPosition, from: Display, to: Display): OverlayPosition {
  const sanitized = sanitizePosition(position)
  return clampPositionToDisplay({
    ...sanitized,
    x: to.workArea.x + (sanitized.x - from.workArea.x),
    y: to.workArea.y + (sanitized.y - from.workArea.y)
  }, to)
}

function samePosition(a: OverlayPosition, b: OverlayPosition): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function isOverlayGestureMode(value: unknown): value is OverlayGestureMode {
  return value === 'move' || value === 'resize'
}

function sanitizePointer(pointer: OverlayPointer): OverlayPointer {
  return {
    x: Math.round(Number.isFinite(pointer.x) ? pointer.x : 0),
    y: Math.round(Number.isFinite(pointer.y) ? pointer.y : 0)
  }
}

function calculateGesturePosition(gesture: OverlayGestureState, pointer: OverlayPointer): OverlayPosition {
  const start = sanitizePointer(gesture.startPointer)
  const current = sanitizePointer(pointer)
  const base = sanitizePosition(gesture.basePosition)
  const dx = current.x - start.x
  const dy = current.y - start.y
  let { x, y, width, height } = base

  if (gesture.mode === 'move') {
    x = base.x + dx
    y = base.y + dy
  } else {
    const dir = gesture.dir
    if (dir.includes('e')) width = base.width + dx
    if (dir.includes('s')) height = base.height + dy
    if (dir.includes('w')) {
      width = base.width - dx
      x = base.x + dx
    }
    if (dir.includes('n')) {
      height = base.height - dy
      y = base.y + dy
    }
    if (width < 160) {
      if (dir.includes('w')) x = base.x + (base.width - 160)
      width = 160
    }
    if (height < 70) {
      if (dir.includes('n')) y = base.y + (base.height - 70)
      height = 70
    }
  }

  return sanitizePosition({ x, y, width, height })
}

function sanitizeGestureState(value: OverlayGestureState): OverlayGestureState {
  return {
    mode: isOverlayGestureMode(value.mode) ? value.mode : 'move',
    dir: typeof value.dir === 'string' ? value.dir : '',
    startPointer: sanitizePointer(value.startPointer),
    basePosition: sanitizePosition(value.basePosition)
  }
}

function clampOpacity(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 100
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed) || /^rgba?\([^)]+\)$/i.test(trimmed)) return trimmed
  return fallback
}

function sanitizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/[<>]/g, '')
  return trimmed.length > 0 && trimmed.length < 90 ? trimmed : fallback
}

function sanitizeStyle(style: Partial<OverlayWidgetStyle> | undefined, presetId?: string): OverlayWidgetStyle {
  const base = { ...getOverlayStylePreset(presetId).style, ...(style ?? {}) }
  const fallback = createDefaultOverlayStyle()
  return {
    background: sanitizeColor(base.background, fallback.background),
    accent: sanitizeColor(base.accent, fallback.accent),
    border: sanitizeColor(base.border, fallback.border),
    radius: Math.max(0, Math.min(36, Math.round(Number.isFinite(base.radius) ? base.radius : fallback.radius))),
    fontFamily: sanitizeFontFamily(base.fontFamily, fallback.fontFamily)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.round(Math.min(max, Math.max(min, numeric)))
}

function sanitizeOptionalColor(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed) || /^rgba?\([^)]+\)$/i.test(trimmed)) return trimmed
  return ''
}

function sanitizeShortText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[<>]/g, '').slice(0, max)
}

function sanitizeCustomDecimals(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(4, Math.max(0, Math.round(value)))
}

function sanitizeCustomElement(value: unknown, index: number): CustomOverlayElement {
  const element = isPlainObject(value) ? value : {}
  return {
    id: typeof element.id === 'string' && element.id.trim() ? element.id.trim() : `el-${Date.now().toString(36)}-${index}`,
    expressionId: typeof element.expressionId === 'string' ? element.expressionId.trim() : '',
    expression: typeof element.expression === 'string' ? element.expression : '',
    expressionName: sanitizeShortText(element.expressionName, 120),
    label: sanitizeShortText(element.label, 80),
    decimals: sanitizeCustomDecimals(element.decimals),
    suffix: sanitizeShortText(element.suffix, 16),
    x: clampNumber(element.x, 0, 8000, 16),
    y: clampNumber(element.y, 0, 8000, 16),
    width: clampNumber(element.width, 10, 8000, 220),
    height: clampNumber(element.height, 10, 8000, 56),
    fontSize: clampNumber(element.fontSize, 8, 240, 26),
    color: sanitizeOptionalColor(element.color),
    align: element.align === 'center' || element.align === 'right' ? element.align : 'left'
  }
}

function normalizeCustomOverlay(value: unknown, fallbackId: string, fallbackCreatedAt = 0): CustomOverlayDef {
  const raw = isPlainObject(value) ? value : {}
  const id = isCustomOverlayId(raw.id) ? (raw.id as string) : fallbackId
  const stylePreset = getOverlayStylePreset(typeof raw.stylePreset === 'string' ? raw.stylePreset : undefined).id
  const elements = Array.isArray(raw.elements) ? raw.elements.map((element, index) => sanitizeCustomElement(element, index)) : []
  const title = typeof raw.title === 'string' && raw.title.trim() ? sanitizeShortText(raw.title, 60) : 'Custom overlay'
  const position = sanitizePosition(isPlainObject(raw.position) ? raw.position : DEFAULT_CUSTOM_OVERLAY_POSITION)
  const overlay: CustomOverlayDef = {
    id,
    title,
    enabled: Boolean(raw.enabled),
    locked: Boolean(raw.locked),
    favorite: Boolean(raw.favorite),
    position,
    opacity: clampOpacity(raw.opacity),
    stylePreset,
    style: sanitizeStyle(isPlainObject(raw.style) ? (raw.style as Partial<OverlayWidgetStyle>) : undefined, stylePreset),
    hidden: Boolean(raw.hidden),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : fallbackCreatedAt,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : fallbackCreatedAt,
    trigger: sanitizeOverlayTrigger(raw.trigger),
    display: sanitizeDisplayRef(raw.display),
    elements
  }
  // RICH content (dashboard widgets) is preserved iff a `widgets` array exists.
  // sanitizeCustomOverlayWidgets returns undefined for legacy defs (no array),
  // keeping the overlay legacy and the persisted shape minimal.
  const widgets = sanitizeCustomOverlayWidgets(raw.widgets)
  if (widgets) {
    overlay.widgets = widgets
    overlay.canvasWidth = clampNumber(raw.canvasWidth, 1, 16000, position.width)
    overlay.canvasHeight = clampNumber(raw.canvasHeight, 1, 16000, position.height)
  }
  return overlay
}

function normalizeCustomOverlays(value: unknown): CustomOverlayDef[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: CustomOverlayDef[] = []
  value.forEach((item, index) => {
    const overlay = normalizeCustomOverlay(
      item,
      `${CUSTOM_OVERLAY_ID_PREFIX}${index}-${Date.now().toString(36)}`,
      index + 1
    )
    if (seen.has(overlay.id)) return
    seen.add(overlay.id)
    result.push(overlay)
  })
  return result
}

function mergeConfig(config: Partial<OverlaysConfig> | null): OverlaysConfig {
  const defaults = createDefaultOverlaysConfig()
  if (!config) return defaults
  const rawWidgets = (isPlainObject(config.widgets) ? config.widgets : {}) as Record<string, Partial<OverlayWidgetConfig> | undefined>
  const legacyWidgets = OVERLAY_WIDGETS.map((definition) => {
    const current = rawWidgets[definition.id]
    const base = defaults.widgets[definition.id]
    const stylePreset = getOverlayStylePreset(current?.stylePreset).id
    return [
      definition.id,
      {
        id: definition.id,
        enabled: Boolean(current?.enabled ?? base.enabled),
        locked: Boolean(current?.locked ?? base.locked),
        favorite: Boolean(current?.favorite ?? base.favorite),
        position: sanitizePosition(current?.position ?? base.position),
        opacity: clampOpacity(current?.opacity ?? base.opacity),
        stylePreset,
        style: sanitizeStyle(current?.style, stylePreset),
        hidden: Boolean(current?.hidden ?? base.hidden),
        role: definition.role,
        trigger: current?.trigger == null
          ? base.trigger ?? definition.defaultTrigger ?? null
          : sanitizeOverlayTriggerForRole(
              current.trigger,
              definition.role,
              base.trigger ?? definition.defaultTrigger
            ),
        display: sanitizeDisplayRef(current?.display)
      }
    ] as const
  })
  const hifiWidgets = Object.entries(rawWidgets)
    .filter(([id]) => isHifiWidgetId(id))
    .map(([id, value]) => {
      const current = (isPlainObject(value) ? value : {}) as Partial<OverlayWidgetConfig>
      const stylePreset = getOverlayStylePreset(current.stylePreset).id
      const moduleId = typeof current.hifiModuleId === 'string' && current.hifiModuleId.trim()
        ? current.hifiModuleId
        : id.slice(5)
      const role = current.role === 'alert' ? 'alert' : hifiModuleRole(moduleId)
      const fallbackTrigger = defaultTriggerForHifiModule(moduleId)
      return [
        id,
        {
          id: id as OverlayWidgetId,
          enabled: Boolean(current.enabled),
          locked: Boolean(current.locked),
          favorite: Boolean(current.favorite),
          position: sanitizePosition(current.position),
          opacity: clampOpacity(current.opacity ?? 100),
          stylePreset,
          style: sanitizeStyle(current.style, stylePreset),
          hidden: Boolean(current.hidden),
          role,
          trigger: current.trigger == null
            ? role === 'alert'
              ? sanitizeOverlayTriggerForRole(null, role, fallbackTrigger)
              : fallbackTrigger ?? null
            : sanitizeOverlayTriggerForRole(current.trigger, role, fallbackTrigger),
          display: sanitizeDisplayRef(current.display),
          hifiModuleId: moduleId
        }
      ] as const
    })

  const merged: OverlaysConfig = {
    configMode: Boolean(config.configMode),
    widgets: Object.fromEntries([...legacyWidgets, ...hifiWidgets]) as OverlaysConfig['widgets'],
    customOverlays: normalizeCustomOverlays(config.customOverlays)
  }

  return merged
}

export class OverlayManager {
  private readonly windows = new Map<string, BrowserWindow>()
  private readonly runtimeHiddenAlerts = new Set<string>()
  private editorTriggerPreviewActive = false
  private editorPreviewOwner: WebContents | null = null
  private unbindEditorPreviewOwner: (() => void) | null = null
  private readonly configPath: string
  private config = createDefaultOverlaysConfig()
  private isDisposing = false
  // Latched once the user DELETES/RESETS the persisted overlays store: while set,
  // save() and scheduleSave() become no-ops so neither a display-event flush nor
  // the before-quit dispose() flush can write our (now stale) in-memory config
  // back to disk — which would resurrect the file the user just deleted. Cleared
  // by any genuine user config mutation (addCustom/updateCustom/removeCustom/
  // setConfig/toggle/setStyle/setLocked/setOpacity) so re-created overlays persist
  // even if the user edits before restarting.
  private resetPending = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private screenListenersRegistered = false
  private readonly reconcileDisplaysForAll = (): void => {
    if (this.isDisposing) return
    void this.clampBoundsForActiveDisplays()
  }

  constructor(private readonly ctx: ModuleContext) {
    this.configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  }

  // Resolve any managed overlay id — a built-in widget id OR a `custom:<uuid>` id
  // — to its live, mutable config entry. Built-in widgets and custom overlays
  // share the same controllable surface (position/locked/opacity/style/display),
  // so window management can stay polymorphic over both.
  private controllable(id: string): OverlayWidgetConfig | CustomOverlayDef | null {
    if (isCustomOverlayId(id)) return this.config.customOverlays.find((overlay) => overlay.id === id) ?? null
    if (isWidgetId(id)) return this.config.widgets[id] ?? null
    return null
  }

  async load(): Promise<void> {
    this.registerScreenListeners()

    try {
      const raw = await readFile(this.configPath, 'utf8')
      this.config = mergeConfig(JSON.parse(raw) as Partial<OverlaysConfig>)
    } catch {
      this.config = createDefaultOverlaysConfig()
      await this.save()
    }

    for (const [id, widget] of Object.entries(this.config.widgets)) {
      if (widget.enabled && !widget.hidden) this.createWindow(id)
    }
    for (const overlay of this.config.customOverlays) {
      if (overlay.enabled && !overlay.hidden) this.createWindow(overlay.id)
    }
  }

  registerIpc(): void {
    this.ctx.ipcMain.handle('overlays:list', () => this.list())
    this.ctx.ipcMain.handle('overlays:getConfig', () => this.config)
    this.ctx.ipcMain.handle('overlays:getDisplays', () => this.getDisplays())
    this.ctx.ipcMain.handle('overlays:setConfig', async (_event, patch: Partial<OverlaysConfig>) => this.setConfig(patch))
    this.ctx.ipcMain.handle('overlays:toggle', async (_event, id: OverlayWidgetId, enabled?: boolean) =>
      this.toggle(id, enabled)
    )
    this.ctx.ipcMain.handle('overlays:setPosition', async (_event, id: string, position: OverlayPosition) =>
      this.setPosition(id, position)
    )
    this.ctx.ipcMain.handle('overlays:setDisplayTarget', async (_event, id: OverlayWidgetId, displayId: number | null) =>
      this.setDisplayTarget(id, displayId)
    )
    this.ctx.ipcMain.handle('overlays:beginGesture', (_event, id: string, mode: OverlayGestureMode, dir: string) =>
      this.beginGesture(id, mode, dir)
    )
    // The live gesture state is kept in the MAIN process (set by beginGesture) and
    // is NOT accepted from the renderer — an untrusted overlay layout must not be
    // able to spoof it (a spoofed base could leak the global cursor position).
    this.ctx.ipcMain.handle('overlays:setBoundsLiveFromGesture', (_event, id: string) =>
      this.setBoundsLiveFromGesture(id)
    )
    this.ctx.ipcMain.handle('overlays:finishGesture', async (_event, id: string) =>
      this.finishGesture(id)
    )
    this.ctx.ipcMain.handle('overlays:setBoundsLive', (_event, id: string, position: OverlayPosition) =>
      this.setBoundsLive(id, position)
    )
    this.ctx.ipcMain.handle('overlays:setLocked', async (_event, id: OverlayWidgetId, locked: boolean) =>
      this.setLocked(id, locked)
    )
    this.ctx.ipcMain.handle('overlays:setFavorite', async (_event, id: OverlayWidgetId, favorite: boolean) =>
      this.setFavorite(id, favorite)
    )
    this.ctx.ipcMain.handle('overlays:setHidden', async (_event, id: OverlayWidgetId, hidden: boolean) =>
      this.setHidden(id, hidden)
    )
    this.ctx.ipcMain.handle('overlays:setOpacity', async (_event, id: OverlayWidgetId, opacity: number) =>
      this.setOpacity(id, opacity)
    )
    this.ctx.ipcMain.handle(
      'overlays:setStyle',
      async (_event, id: OverlayWidgetId, patch: Partial<Pick<OverlayWidgetConfig, 'stylePreset' | 'style'>>) =>
        this.setStyle(id, patch)
    )
    this.ctx.ipcMain.handle('overlays:setRuntimeVisibility', (event, id: string, visible: boolean) => {
      const win = this.windows.get(id)
      if (!win || win.isDestroyed() || win.webContents !== event.sender) return
      this.setRuntimeVisibility(id, visible)
    })
    this.ctx.ipcMain.handle(
      OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive,
      (event, active: boolean) => {
        const mainWindow = this.ctx.getMainWindow()
        const requestedActive = Boolean(active)
        if (
          !mainWindow ||
          mainWindow.isDestroyed() ||
          mainWindow.webContents.isDestroyed() ||
          event.sender !== mainWindow.webContents
        ) {
          return false
        }
        if (
          requestedActive &&
          (!mainWindow.isVisible() || mainWindow.webContents.isLoadingMainFrame())
        ) {
          this.setEditorPreviewActive(false)
          return false
        }
        if (requestedActive) {
          this.setEditorPreviewActiveForOwner(mainWindow, event.sender)
        } else {
          this.setEditorPreviewActive(false)
        }
        return true
      }
    )
    // ─── Custom overlays (designer) ────────────────────────────────────────────
    this.ctx.ipcMain.handle('overlays:listCustom', () => this.listCustom())
    this.ctx.ipcMain.handle('overlays:getCustom', (_event, id: string) => this.getCustom(id))
    this.ctx.ipcMain.handle('overlays:addCustom', async (_event, input: unknown) => this.addCustom(input))
    this.ctx.ipcMain.handle('overlays:updateCustom', async (_event, id: string, patch: unknown) => this.updateCustom(id, patch))
    this.ctx.ipcMain.handle('overlays:removeCustom', async (_event, id: string) => this.removeCustom(id))
    this.ctx.ipcMain.handle('overlays:iracingGraphicsStatus', () => readIracingGraphicsStatus())
    this.ctx.ipcMain.handle('overlays:fixIracingFullscreen', () => fixIracingFullscreen())
  }

  getDisplays(): OverlayDisplayInfo[] {
    const displays = screen.getAllDisplays()
    const primaryId = screen.getPrimaryDisplay().id
    return displays.map((display, index) => ({
      ...displayRefFor(display, index),
      label: displayLabel(display, index, primaryId),
      primary: display.id === primaryId
    }))
  }

  list(): OverlayListItem[] {
    return OVERLAY_WIDGETS.map((definition) => ({
      ...definition,
      ...this.config.widgets[definition.id],
      visible: Boolean(this.windows.get(definition.id) && !this.windows.get(definition.id)?.isDestroyed())
    }))
  }

  listCustom(): CustomOverlayListItem[] {
    return this.config.customOverlays.map((overlay) => ({
      ...overlay,
      visible: Boolean(this.windows.get(overlay.id) && !this.windows.get(overlay.id)?.isDestroyed())
    }))
  }

  getCustom(id: string): CustomOverlayDef | null {
    const overlay = this.config.customOverlays.find((item) => item.id === id)
    return overlay ? { ...overlay, elements: overlay.elements.map((element) => ({ ...element })) } : null
  }

  async addCustom(input: unknown): Promise<CustomOverlayListItem[]> {
    this.resetPending = false
    // Always assign a fresh server-side id; never trust an id from the renderer
    // draft (prevents collisions and id spoofing across overlays).
    const base = isPlainObject(input) ? { ...input } : {}
    delete (base as Record<string, unknown>).id
    delete (base as Record<string, unknown>).createdAt
    delete (base as Record<string, unknown>).updatedAt
    const now = Date.now()
    const overlay = normalizeCustomOverlay(
      { ...base, createdAt: now, updatedAt: now },
      `${CUSTOM_OVERLAY_ID_PREFIX}${randomUUID()}`
    )
    this.config.customOverlays.push(overlay)
    if (overlay.enabled) this.createWindow(overlay.id)
    await this.save()
    this.broadcastState()
    return this.listCustom()
  }

  async updateCustom(id: string, patch: unknown): Promise<CustomOverlayListItem[]> {
    this.resetPending = false
    const index = this.config.customOverlays.findIndex((item) => item.id === id)
    if (index < 0) throw new Error(`Unknown custom overlay: ${String(id)}`)
    const previous = this.config.customOverlays[index]
    // Force the id to stay the same — a patch must never re-key the overlay.
    const merged = normalizeCustomOverlay({
      ...previous,
      ...(isPlainObject(patch) ? patch : {}),
      id: previous.id,
      createdAt: previous.createdAt,
      updatedAt: Date.now()
    }, previous.id)
    this.config.customOverlays[index] = merged
    this.syncWindow(id, merged)
    this.pushCustomDef(id)
    await this.save()
    this.broadcastState()
    return this.listCustom()
  }

  async removeCustom(id: string): Promise<CustomOverlayListItem[]> {
    this.resetPending = false
    this.destroyWindow(id)
    this.config.customOverlays = this.config.customOverlays.filter((item) => item.id !== id)
    await this.save()
    this.broadcastState()
    return this.listCustom()
  }

  private pushCustomDef(id: string): void {
    const win = this.windows.get(id)
    const overlay = this.config.customOverlays.find((item) => item.id === id)
    if (!win || win.isDestroyed() || !overlay) return
    win.webContents.send('overlays:customDef', overlay)
  }

  async setConfig(patch: Partial<OverlaysConfig>): Promise<OverlaysConfig> {
    this.resetPending = false
    this.config = mergeConfig({
      ...this.config,
      ...patch,
      widgets: { ...this.config.widgets, ...patch.widgets }
    })
    await this.applyConfigToWindows()
    await this.save()
    this.broadcastState()
    return this.config
  }

  private setRuntimeVisibility(id: string, visible: boolean): void {
    if (!this.isAlertOverlay(id)) return
    if (visible) this.runtimeHiddenAlerts.delete(id)
    else this.runtimeHiddenAlerts.add(id)
    this.updateMouseMode(id)
  }

  private setEditorPreviewActive(active: boolean): void {
    if (!active) this.releaseEditorPreviewOwnership()
    this.applyEditorPreviewActive(active)
  }

  private setEditorPreviewActiveForOwner(
    mainWindow: BrowserWindow,
    owner: WebContents
  ): void {
    if (this.editorPreviewOwner !== owner) {
      this.releaseEditorPreviewOwnership()
      this.editorPreviewOwner = owner
      this.unbindEditorPreviewOwner = bindEditorPreviewOwnerLifecycle(
        mainWindow,
        (releasedOwner) => this.clearEditorPreviewForOwner(releasedOwner)
      )
    }
    this.applyEditorPreviewActive(true)
  }

  private clearEditorPreviewForOwner(owner: WebContents): void {
    if (this.editorPreviewOwner !== owner) return
    this.releaseEditorPreviewOwnership()
    this.applyEditorPreviewActive(false)
  }

  private releaseEditorPreviewOwnership(): void {
    const unbind = this.unbindEditorPreviewOwner
    this.unbindEditorPreviewOwner = null
    this.editorPreviewOwner = null
    unbind?.()
  }

  private applyEditorPreviewActive(active: boolean): void {
    this.editorTriggerPreviewActive = active
    for (const id of this.windows.keys()) this.updateMouseMode(id)
  }

  async toggle(id: OverlayWidgetId, enabled?: boolean): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    this.resetPending = false
    const widget = this.config.widgets[id]
    widget.enabled = enabled ?? !widget.enabled
    logger.info('overlays', `overlay toggled ${widget.enabled ? 'on' : 'off'}`, { id, enabled: widget.enabled })

    if (widget.enabled && !widget.hidden) this.createWindow(id)
    else this.destroyWindow(id)

    await this.save()
    this.broadcastState()
    return this.list()
  }

  async setPosition(id: string, position: OverlayPosition): Promise<OverlayListItem[]> {
    const entry = this.controllable(id)
    if (!entry) throw new Error(`Unknown overlay: ${String(id)}`)
    const landed = clampPositionToVirtualWorkArea(position)
    const { display, index } = displayForPosition(landed)
    const sanitized = clampPositionToDisplay(landed, display)
    entry.display = displayRefFor(display, index)
    entry.position = sanitized
    this.windows.get(id)?.setBounds(sanitized)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  async setDisplayTarget(id: OverlayWidgetId, displayId: number | null): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    const displays = screen.getAllDisplays()
    const targetIndex = displays.findIndex((display) => display.id === displayId)
    if (displayId !== null && targetIndex < 0) throw new Error(`Unknown display: ${String(displayId)}`)
    const widget = this.config.widgets[id]
    const currentDisplay = resolveDisplay(widget.display, widget.position)
    if (displayId === null) {
      widget.display = null
      widget.position = clampPositionToDisplays(widget.position)
    } else {
      const target = displays[targetIndex]
      widget.display = displayRefFor(target, targetIndex)
      widget.position = translatePositionToDisplay(widget.position, currentDisplay, target)
    }
    this.windows.get(id)?.setBounds(widget.position)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  private activeGesture: { id: string; state: OverlayGestureState } | null = null

  beginGesture(id: string, mode: OverlayGestureMode, dir: string): OverlayGestureState {
    const entry = this.controllable(id)
    if (!entry) throw new Error(`Unknown overlay: ${String(id)}`)
    const win = this.windows.get(id)
    const state: OverlayGestureState = {
      mode: isOverlayGestureMode(mode) ? mode : 'move',
      dir,
      startPointer: sanitizePointer(screen.getCursorScreenPoint()),
      basePosition: sanitizePosition(win && !win.isDestroyed() ? win.getBounds() : entry.position)
    }
    this.activeGesture = { id, state }
    return state
  }

  setBoundsLiveFromGesture(id: string): OverlayPosition | null {
    const entry = this.controllable(id)
    if (!entry) return null
    if (!this.activeGesture || this.activeGesture.id !== id) return null
    const nextPosition = calculateGesturePosition(sanitizeGestureState(this.activeGesture.state), screen.getCursorScreenPoint())
    this.setBoundsLive(id, nextPosition)
    return entry.position
  }

  async finishGesture(id: string): Promise<OverlayListItem[]> {
    if (!this.controllable(id)) throw new Error(`Unknown overlay: ${String(id)}`)
    const gesture = this.activeGesture && this.activeGesture.id === id ? this.activeGesture.state : null
    this.activeGesture = null
    if (!gesture) return this.list()
    const nextPosition = calculateGesturePosition(sanitizeGestureState(gesture), screen.getCursorScreenPoint())
    return this.setPosition(id, nextPosition)
  }

  // Live drag/resize coming from the overlay window itself: apply the new bounds
  // immediately for a smooth gesture but DEFER the disk write (debounced) so a
  // ~60fps mouse drag doesn't thrash the config file. setPosition() finalises
  // (and persists) once on mouse-up.
  setBoundsLive(id: string, position: OverlayPosition): void {
    const entry = this.controllable(id)
    if (!entry) return
    const sanitized = clampPositionToVirtualWorkArea(position)
    entry.position = sanitized
    this.windows.get(id)?.setBounds(sanitized)
    this.broadcastList()
    this.scheduleSave()
  }

  async setLocked(id: OverlayWidgetId, locked: boolean): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    this.resetPending = false
    this.config.widgets[id].locked = locked
    this.updateMouseMode(id)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  // Favorite is purely a configuration-list sort hint — it never creates,
  // destroys or moves an overlay window, so no compositor sync is required.
  async setFavorite(id: OverlayWidgetId, favorite: boolean): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    this.resetPending = false
    this.config.widgets[id].favorite = Boolean(favorite)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  async setHidden(id: OverlayWidgetId, hidden: boolean): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    this.resetPending = false
    const widget = this.config.widgets[id]
    widget.hidden = Boolean(hidden)
    if (widget.hidden) this.destroyWindow(id)
    else this.syncWindow(id, widget)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  async setOpacity(id: OverlayWidgetId, opacity: number): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    this.resetPending = false
    this.config.widgets[id].opacity = clampOpacity(opacity)
    this.applyOpacity(id)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  async setStyle(id: OverlayWidgetId, patch: Partial<Pick<OverlayWidgetConfig, 'stylePreset' | 'style'>>): Promise<OverlayListItem[]> {
    if (!isWidgetId(id) || !this.config.widgets[id]) throw new Error(`Unknown overlay widget: ${String(id)}`)
    this.resetPending = false
    const current = this.config.widgets[id]
    const stylePreset = getOverlayStylePreset(patch.stylePreset ?? current.stylePreset).id
    current.stylePreset = stylePreset
    current.style = sanitizeStyle(patch.style ?? current.style, stylePreset)
    await this.save()
    this.broadcastState()
    return this.list()
  }

  // Called when the user DELETES/RESETS the persisted `overlays` store via the
  // "Settings salvas" panel (signalled from config-export over ipcMain).
  // Without this, the still-live manager keeps the OLD overlays in memory and a
  // pending debounced save — or the before-quit dispose() flush — would WRITE
  // them back, RESURRECTING the file the user deleted. We cancel any pending
  // save, latch a no-persist flag so nothing can re-persist before relaunch, and
  // drop the cache to factory default so there is nothing stale left to flush.
  dropInMemoryForReset(): void {
    this.resetPending = true
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.config = createDefaultOverlaysConfig()
  }

  // Called when the user IMPORTS the `overlays` store via the export/import panel:
  // its file on disk was just overwritten, but our in-memory `config` is the OLD
  // copy and overlays cannot hot-swap their live windows mid-session (the UI marks
  // this section "Reinicie para aplicar"). Without this, a pending debounced save
  // — or the before-quit dispose() flush — would WRITE our stale config back and
  // CLOBBER the freshly-imported file ("importei mas voltou ao reiniciar"). We
  // cancel any pending save and latch the no-persist flag so nothing overwrites
  // the imported file before relaunch. Unlike dropInMemoryForReset we KEEP the
  // current live config, so overlays don't blank mid-session. The latch clears on
  // any genuine user mutation (setConfig/toggle/…), matching the reset behaviour.
  suspendPersistenceForImport(): void {
    this.resetPending = true
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
  }

  async dispose(): Promise<void> {
    this.isDisposing = true
    this.releaseEditorPreviewOwnership()
    this.editorTriggerPreviewActive = false
    this.unregisterScreenListeners()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      await this.save()
    }
    logger.info('overlays', 'dispose: closing overlay windows', { count: this.windows.size })
    for (const id of [...this.windows.keys()]) this.destroyWindow(id)
  }

  private syncWindow(id: string, current: { enabled: boolean; hidden?: boolean; position: OverlayPosition; display?: OverlayDisplayRef | null }): void {
    if (current.enabled && !current.hidden) {
      const win = this.windows.get(id)
      if (win && !win.isDestroyed()) {
        win.setBounds(clampPositionToDisplays(current.position, current.display))
        this.applyOpacity(id)
        this.updateMouseMode(id)
      } else {
        this.createWindow(id)
      }
    } else {
      this.destroyWindow(id)
    }
  }

  private async applyConfigToWindows(): Promise<void> {
    for (const [id, widget] of Object.entries(this.config.widgets)) {
      this.syncWindow(id, widget)
    }
    for (const overlay of this.config.customOverlays) {
      this.syncWindow(overlay.id, overlay)
    }
  }

  private createWindow(id: string): void {
    const widget = this.controllable(id)
    if (!widget || widget.hidden) return
    const existing = this.windows.get(id)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      return
    }

    const initialBounds = clampPositionToDisplays(widget.position, widget.display)
    widget.position = initialBounds
    const win = new BrowserWindow({
      ...initialBounds,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      movable: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: `Overlay ${id}`,
      webPreferences: {
        // Dedicated minimal preload — overlays must not see window.api.
        preload: join(__dirname, '../preload/overlay.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Keep overlays rendering when a fullscreen sim occludes their windows.
        backgroundThrottling: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setFullScreenable(false)
    this.windows.set(id, win)
    if (this.isAlertOverlay(id)) this.runtimeHiddenAlerts.add(id)
    logger.info('overlays', 'overlay window created', { id, bounds: initialBounds })
    this.applyOpacity(id)
    this.updateMouseMode(id)

    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
      if (isAllowedAppNavigation(url)) return
      event.preventDefault()
      openExternalUrl(url)
    })

    win.on('moved', () => this.captureBounds(id))
    win.on('resized', () => this.captureBounds(id))
    win.on('show', () => this.reassertTopmost(id))
    win.on('focus', () => this.reassertTopmost(id))
    win.on('blur', () => this.reassertTopmost(id))
    win.on('restore', () => this.reassertTopmost(id))
    win.on('closed', () => {
      // Window-identity-aware: a manager-initiated destroy can pre-delete the map
      // entry and a re-create can install a new window at this id before this
      // async 'closed' fires. Only act if we still own (or have vacated) the slot,
      // never evicting a freshly re-created window for the same id.
      if (this.windows.get(id) === win) this.windows.delete(id)
      if (!this.isDisposing && this.windows.get(id) === undefined) {
        const entry = this.controllable(id)
        if (entry) entry.enabled = false
        void this.save().then(() => this.broadcastState())
      }
    })

    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return
      this.reassertTopmost(id)
      win.webContents.send('overlays:state', this.list())
      win.webContents.send('overlays:configMode', this.getWindowConfigPayload(id))
      this.pushEditorPreviewState(id)
      if (isCustomOverlayId(id)) this.pushCustomDef(id)
      // Seed the overlay with whatever the hub currently has. Live updates flow
      // via the main 'telemetry:snapshot' broadcast registered in modules/telemetry.ts.
      win.webContents.send('telemetry:snapshot', this.ctx.telemetryHub.getLatest())
    })

    const devUrl = devRendererUrl()
    if (devUrl) {
      const url = new URL('overlay.html', devUrl)
      url.searchParams.set('widget', id)
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(join(__dirname, '../renderer/overlay.html'), { query: { widget: id } })
    }
  }

  private registerScreenListeners(): void {
    if (this.screenListenersRegistered) return
    screen.on('display-metrics-changed', this.reconcileDisplaysForAll)
    screen.on('display-added', this.reconcileDisplaysForAll)
    screen.on('display-removed', this.reconcileDisplaysForAll)
    this.screenListenersRegistered = true
  }

  private unregisterScreenListeners(): void {
    if (!this.screenListenersRegistered) return
    screen.off('display-metrics-changed', this.reconcileDisplaysForAll)
    screen.off('display-added', this.reconcileDisplaysForAll)
    screen.off('display-removed', this.reconcileDisplaysForAll)
    this.screenListenersRegistered = false
  }

  private async clampBoundsForActiveDisplays(): Promise<void> {
    let changed = false
    for (const id of this.windows.keys()) {
      const entry = this.controllable(id)
      if (!entry) continue
      const current = entry.position
      const clamped = clampPositionToDisplays(current, entry.display)
      if (!samePosition(current, clamped)) {
        entry.position = clamped
        const win = this.windows.get(id)
        if (win && !win.isDestroyed()) win.setBounds(clamped)
        changed = true
      }
      this.reassertTopmost(id)
    }
    if (changed) {
      await this.save()
      this.broadcastState()
    }
  }

  private reassertTopmost(id: string): void {
    const win = this.windows.get(id)
    if (!win || win.isDestroyed()) return
    // Only re-assert always-on-top. Do NOT call show()/showInactive() here: forcing the
    // window forward while an exclusive-fullscreen game holds focus can drop the game to
    // the desktop or make it flicker. Re-asserting topmost is enough for the supported
    // borderless/windowed setup.
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  private destroyWindow(id: string): void {
    const win = this.windows.get(id)
    if (!win || win.isDestroyed()) return
    this.windows.delete(id)
    this.runtimeHiddenAlerts.delete(id)
    logger.info('overlays', 'overlay window destroyed', { id })
    win.close()
  }

  private applyOpacity(id: string): void {
    const win = this.windows.get(id)
    const entry = this.controllable(id)
    if (!win || win.isDestroyed() || !entry) return
    win.setOpacity(entry.opacity / 100)
  }

  private getWindowConfigPayload(id: string): (OverlayWidgetConfig & { configMode: boolean; title?: string }) | null {
    const entry = this.controllable(id)
    if (!entry) return null
    return { ...entry, id: entry.id as OverlayWidgetId, configMode: this.config.configMode }
  }

  private updateMouseMode(id: string): void {
    const win = this.windows.get(id)
    const entry = this.controllable(id)
    if (!win || win.isDestroyed() || !entry) return
    // Per-overlay interactivity: inactive alerts stay click-through unless the
    // isolated editor ghost is active. Runtime visibility remains latched in
    // runtimeHiddenAlerts; the ghost only exposes the existing positioning surface.
    const editorPreviewActive = this.shouldShowEditorPreview(id, entry)
    const clickThrough =
      (this.runtimeHiddenAlerts.has(id) && !editorPreviewActive) ||
      (!this.config.configMode && Boolean(entry.locked))
    win.setIgnoreMouseEvents(clickThrough, { forward: true })
    win.webContents.send('overlays:configMode', this.getWindowConfigPayload(id))
    this.pushEditorPreviewState(id)
  }

  private shouldShowEditorPreview(
    id: string,
    entry: OverlayWidgetConfig | CustomOverlayDef
  ): boolean {
    return (
      this.editorTriggerPreviewActive &&
      this.runtimeHiddenAlerts.has(id) &&
      this.isAlertOverlay(id) &&
      (this.config.configMode || !entry.locked)
    )
  }

  private pushEditorPreviewState(id: string): void {
    const win = this.windows.get(id)
    const entry = this.controllable(id)
    if (!win || win.isDestroyed() || !entry) return
    const payload: OverlayEditorPreviewState = {
      active: this.shouldShowEditorPreview(id, entry)
    }
    win.webContents.send(OVERLAY_EDITOR_PREVIEW_CHANNELS.state, payload)
  }

  private isAlertOverlay(id: string): boolean {
    if (id.startsWith(CUSTOM_OVERLAY_ID_PREFIX)) return false
    if (id.startsWith('hifi:')) {
      const entry = this.config.widgets[id as OverlayWidgetId]
      const moduleId = entry?.hifiModuleId ?? id.slice(5)
      return entry?.role === 'alert' || hifiModuleRole(moduleId) === 'alert'
    }
    return OVERLAY_WIDGETS.find((definition) => definition.id === id)?.role === 'alert'
  }

  private captureBounds(id: string): void {
    const win = this.windows.get(id)
    const entry = this.controllable(id)
    if (!win || win.isDestroyed() || !entry) return
    const bounds = win.getBounds()
    if (this.activeGesture?.id === id) {
      entry.position = clampPositionToVirtualWorkArea(bounds)
    } else {
      const landed = clampPositionToVirtualWorkArea(bounds)
      const { display, index } = displayForPosition(landed)
      entry.display = displayRefFor(display, index)
      entry.position = clampPositionToDisplay(landed, display)
    }
    this.broadcastList()
    this.scheduleSave()
  }

  private broadcastList(): void {
    // High-frequency (live drag/resize) update — only the main window's
    // OverlaysView consumes 'overlays:state', so avoid spamming every overlay
    // window the way the full broadcast() would.
    // Once disposing, a late drag/resize IPC could land while the main window's
    // webContents is destroyed-but-not-yet-null: `?.` only guards a null window,
    // not a destroyed one, so an unguarded send would throw "Object has been
    // destroyed" → fatal handler → process.exit(1), bypassing clean teardown.
    if (this.isDisposing) return
    const mw = this.ctx.getMainWindow()
    if (mw && !mw.isDestroyed() && !mw.webContents.isDestroyed()) {
      mw.webContents.send('overlays:state', this.list())
      mw.webContents.send('overlays:customState', this.listCustom())
    }
  }

  private scheduleSave(): void {
    if (this.resetPending) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 250)
  }

  private broadcastState(): void {
    // Once disposing, the windows are being torn down — a late debounced save()
    // (or the save().then(broadcastState) on a window 'closed') can resolve AFTER
    // destroy and send to a destroyed webContents, throwing "Object has been
    // destroyed" and aborting the clean quit. Nothing to broadcast anyway.
    if (this.isDisposing) return
    this.ctx.broadcast('overlays:state', this.list())
    // `?.` only guards a null main window, not a destroyed one — guard both the
    // window and its webContents before sending (defense in depth).
    const mw = this.ctx.getMainWindow()
    if (mw && !mw.isDestroyed() && !mw.webContents.isDestroyed()) {
      mw.webContents.send('overlays:customState', this.listCustom())
    }
    for (const id of this.windows.keys()) {
      this.applyOpacity(id)
      this.updateMouseMode(id)
    }
  }

  private async save(): Promise<void> {
    // No-op once a reset/delete is pending: persisting here would re-create the
    // overlays.json the user just deleted (resurrection bug).
    if (this.resetPending) return
    await writeFile(this.configPath, `${JSON.stringify(this.config, null, 2)}
`, 'utf8')
  }
}

