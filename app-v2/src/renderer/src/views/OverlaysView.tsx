import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { CustomOverlayDef, CustomOverlayElement, CustomOverlayElementAlign, CustomOverlayListItem, IracingGraphicsStatus, FixIracingFullscreenResult, OverlayListItem, OverlayPosition, OverlayWidgetId, OverlayWidgetStyle, OverlaysConfig } from '../../../shared/overlays'
import { createCustomOverlayDef, createCustomOverlayElement, createRichCustomOverlayDef, isRichCustomOverlay, OVERLAY_FORMS, overlayDesignFamily, overlayWidgetDisplayTitle } from '../../../shared/overlays'
import type { SimId } from '../../../shared/telemetry'
import { PLAYABLE_SIMS, simLabel, widgetSupportedSims } from '../../../shared/sim-coverage'
import { OverlayWidgetBuilder } from './overlay/OverlayWidgetBuilder'
import { EXPR_CHANNELS, type ExpressionDef } from '../../../shared/expr'
import { IRACING_VARIABLES, IRACING_VAR_CATEGORY_LABELS, IRACING_VAR_CATEGORY_ORDER } from '../../../shared/iracing-vars'
import type { StreamingStartResult, StreamingStatus } from '../../../shared/streaming'
import { STREAMING_CHANNELS } from '../../../shared/streaming'
import type { AppViewProps } from '../App'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { SectionExportImport } from '../components/SectionExportImport'
import { TagFilter, filterByTags } from '../components/TagFilter'
import { ALL_OVERLAY_WIDGETS, createDefaultOverlaysConfigWithHifi, hasAllHifiOverlayConfigs, mergeHifiOverlayConfigs, mergeHifiOverlayItems } from '../overlay/hifi-overlays'
import '../overlay/overlay-view.css'

const POSITION_KEYS: Array<keyof OverlayPosition> = ['x', 'y', 'width', 'height']
const ELEMENT_BOX_KEYS: Array<keyof Pick<CustomOverlayElement, 'x' | 'y' | 'width' | 'height'>> = ['x', 'y', 'width', 'height']
const DECIMALS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' }
]
const ALIGN_OPTIONS: CustomOverlayElementAlign[] = ['left', 'center', 'right']
const FONT_OPTIONS = [
  'Segoe UI, sans-serif',
  'Bahnschrift, Segoe UI, sans-serif',
  'DIN Condensed, Bahnschrift, Segoe UI, sans-serif',
  'Consolas, Cascadia Mono, monospace'
]

// Each custom-overlay element binds to EITHER a saved expression (expressionId =
// `expr-…`) OR a raw iRacing telemetry channel. Channels are encoded in the SAME
// expressionId field as `channel:<VarId>` (e.g. `channel:Speed`), so no
// CustomOverlayElement model / persistence change is needed — the overlay widget
// resolves the var id as a trivial expression against the live TelemetrySnapshot.
const CHANNEL_BINDING_PREFIX = 'channel:'

function channelVarIdFromBinding(expressionId: string): string | null {
  return expressionId.startsWith(CHANNEL_BINDING_PREFIX) ? expressionId.slice(CHANNEL_BINDING_PREFIX.length) : null
}

// Directly-bindable telemetry channels = catalog vars that map to a
// TelemetrySnapshot field (telemetryField). Grouped by category to mirror the
// Expressions menu so the picker is always populated even with zero saved expressions.
const BINDABLE_TELEMETRY_GROUPS = IRACING_VAR_CATEGORY_ORDER
  .map((category) => ({
    category,
    label: IRACING_VAR_CATEGORY_LABELS[category],
    variables: IRACING_VARIABLES.filter((item) => item.category === category && item.telemetryField)
  }))
  .filter((group) => group.variables.length > 0)

const BINDABLE_TELEMETRY_COUNT = BINDABLE_TELEMETRY_GROUPS.reduce((sum, group) => sum + group.variables.length, 0)

function configModeFrom(items: OverlayListItem[], fallback: OverlaysConfig): OverlaysConfig {
  return {
    ...fallback,
    overlayCompositorEnabled: fallback.overlayCompositorEnabled ?? false,
    widgets: {
      ...fallback.widgets,
      ...Object.fromEntries(items.map((item) => [item.id, {
        id: item.id,
        enabled: item.enabled,
        locked: item.locked,
        favorite: item.favorite,
        position: item.position,
        display: item.display,
        opacity: item.opacity,
        stylePreset: item.stylePreset,
        style: item.style,
        hidden: item.hidden,
        hifiModuleId: item.hifiModuleId
      }]))
    } as OverlaysConfig['widgets']
  }
}

function definitionTags(def: { category?: string; tags?: string[] } | undefined): string[] {
  if (!def) return []
  return [...new Set([def.category, ...(def.tags ?? [])].filter((tag): tag is string => Boolean(tag)))]
}

// Configuration-list ordering is intentionally independent from enabled state:
// toggling an overlay must not move its card and make the page jump.
function sortOverlayEntries<T extends { enabled: boolean; favorite?: boolean }>(entries: T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const favoriteRank = (a.entry.favorite ? 0 : 1) - (b.entry.favorite ? 0 : 1)
      if (favoriteRank !== 0) return favoriteRank
      return a.index - b.index
    })
    .map((item) => item.entry)
}

// Flattened quick-access entry for the "Overlays ativos" panel — unifies built-in
// widgets and custom overlays so each can be toggled/favorited from one place.
type ActiveOverlayEntry = { id: string; title: string; favorite: boolean; kind: 'widget' | 'custom' }

function isSelectedOverlayForm(currentPreset: string | undefined, formPreset: string): boolean {
  return overlayDesignFamily(currentPreset) === overlayDesignFamily(formPreset)
}

export default function OverlaysView(_props: AppViewProps): ReactElement {
  const [items, setItems] = useState<OverlayListItem[]>([])
  const [config, setConfig] = useState<OverlaysConfig>(createDefaultOverlaysConfigWithHifi())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posDrafts, setPosDrafts] = useState<Record<string, string>>({})
  const [iracingGfx, setIracingGfx] = useState<IracingGraphicsStatus | null>(null)
  // Monitors/displays come from the shared device registry so Overlays and
  // Dashboards target the same screens detected in the Devices hub.
  const { displays, refreshDisplays } = useDevices()
  const [gfxNote, setGfxNote] = useState<string | null>(null)
  const [customOverlays, setCustomOverlays] = useState<CustomOverlayListItem[]>([])
  const [expressions, setExpressions] = useState<ExpressionDef[]>([])
  const [designerOpen, setDesignerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomOverlayDef | null>(null)
  // Rich widget builder ("Create new overlay") — separate from the legacy
  // expression/channel designer above.
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderEditingId, setBuilderEditingId] = useState<string | null>(null)
  const [builderDraft, setBuilderDraft] = useState<CustomOverlayDef | null>(null)
  const [streamSafe, setStreamSafe] = useState(true)
  const [streamLanEnabled, setStreamLanEnabled] = useState(false)
  const [streamPassword, setStreamPassword] = useState('')
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus | null>(null)
  const [copiedStreamUrl, setCopiedStreamUrl] = useState(false)
  const enabledCount = useMemo(() => items.filter((item) => item.enabled).length, [items])
  const sortedItems = useMemo(() => sortOverlayEntries(items), [items])
  const [selectedWidgetIds, setSelectedWidgetIds] = useState<Set<string>>(() => new Set())
  const [selectedCustomIds, setSelectedCustomIds] = useState<Set<string>>(() => new Set())
  // Per-yes availability: a widget is shown for the chosen yes only when that yes's
  // live telemetry provides every field the widget requires (sim-coverage). 'all'
  // shows everything. The title is prefixed "(IR/ACC/LMU)" with its supported sims.
  const [simFilter, setSimFilter] = useState<SimId | 'all'>('all')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const defById = useMemo(() => new Map(ALL_OVERLAY_WIDGETS.map((def) => [def.id, def])), [])
  const displayTitleFor = useCallback(
    (id: string, fallback: string): string => {
      const def = defById.get(id as OverlayWidgetId)
      return def ? overlayWidgetDisplayTitle(def) : fallback
    },
    [defById]
  )
  const simFilteredItems = useMemo(() => {
    return sortedItems.filter((item) => {
      if (item.hidden) return false
      const def = defById.get(item.id as OverlayWidgetId)
      return simFilter === 'all' || !def || widgetSupportedSims(def.requires).includes(simFilter)
    })
  }, [sortedItems, simFilter, defById])
  const hiddenItems = useMemo(() => sortedItems.filter((item) => item.hidden), [sortedItems])
  const visibleItems = useMemo(() => {
    return filterByTags(simFilteredItems, tagFilters, (item) => definitionTags(defById.get(item.id as OverlayWidgetId)))
  }, [simFilteredItems, tagFilters, defById])
  const sortedCustomOverlays = useMemo(() => sortOverlayEntries(customOverlays), [customOverlays])
  const visibleCustomOverlays = useMemo(() => sortedCustomOverlays.filter((overlay) => !overlay.hidden), [sortedCustomOverlays])
  const hiddenCustomOverlays = useMemo(() => sortedCustomOverlays.filter((overlay) => overlay.hidden), [sortedCustomOverlays])
  const activeOverlays = useMemo<ActiveOverlayEntry[]>(() => [
    ...items
      .filter((item) => item.enabled && !item.hidden)
      .map((item) => ({ id: item.id, title: item.title, favorite: Boolean(item.favorite), kind: 'widget' as const })),
    ...customOverlays
      .filter((overlay) => overlay.enabled && !overlay.hidden)
      .map((overlay) => ({ id: overlay.id, title: overlay.title, favorite: Boolean(overlay.favorite), kind: 'custom' as const }))
  ], [items, customOverlays])
  const displayOptions = useMemo(() => displays.map((display) => ({
    value: String(display.id),
    label: display.label
  })), [displays])

  async function refreshIracingGfx(): Promise<void> {
    const status = await window.ipc.invoke<IracingGraphicsStatus>('overlays:iracingGraphicsStatus')
    setIracingGfx(status)
  }

  async function refreshStreamingStatus(): Promise<void> {
    const status = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.status)
    setStreamingStatus(status)
    setStreamSafe(status.streamSafe)
    setStreamLanEnabled(status.lanEnabled)
  }

  async function startStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopiedStreamUrl(false)
    try {
      await window.ipc.invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
        streamSafe,
        layoutId: 'default',
        lanEnabled: streamLanEnabled,
        password: streamPassword.trim() || undefined
      })
      setStreamPassword('')
      await refreshStreamingStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OBS streaming')
    } finally {
      setBusy(false)
    }
  }

  async function stopStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopiedStreamUrl(false)
    try {
      const status = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.stop)
      setStreamingStatus(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop OBS streaming')
    } finally {
      setBusy(false)
    }
  }

  async function copyStreamUrl(): Promise<void> {
    if (!streamingStatus?.url) return
    try {
      await navigator.clipboard.writeText(streamingStatus.url)
      setCopiedStreamUrl(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy OBS URL')
    }
  }

  async function copyTouchStreamUrl(): Promise<void> {
    if (!streamingStatus?.touchUrl) return
    try {
      await navigator.clipboard.writeText(streamingStatus.touchUrl)
      setCopiedStreamUrl(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy Touch Controls URL')
    }
  }

  async function fixIracingFullscreen(): Promise<void> {
    const ok = window.confirm(
      'This will switch iRacing to borderless mode (edits app.ini with a .ubbak backup).\n\n' +
      'CLOSE iRacing before continuing — the change only applies after reopening the game.\n\nContinue?'
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setGfxNote(null)
    try {
      const result = await window.ipc.invoke<FixIracingFullscreenResult>('overlays:fixIracingFullscreen')
      setGfxNote(result.message)
      await refreshIracingGfx()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust iRacing')
    } finally {
      setBusy(false)
    }
  }

  async function refresh(): Promise<void> {
    const [nextItems, loadedConfig, nextCustom, nextExpressions, compositorEnabled] = await Promise.all([
      window.ipc.invoke<OverlayListItem[]>('overlays:list'),
      window.ipc.invoke<OverlaysConfig>('overlays:getConfig'),
      window.ipc.invoke<CustomOverlayListItem[]>('overlays:listCustom'),
      window.ipc.invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions),
      window.ipc.invoke<boolean>('overlays:getCompositorEnabled')
    ])
    const nextConfig = hasAllHifiOverlayConfigs(loadedConfig)
      ? mergeHifiOverlayConfigs(loadedConfig)
      : mergeHifiOverlayConfigs(await window.ipc.invoke<OverlaysConfig>('overlays:setConfig', mergeHifiOverlayConfigs(loadedConfig)))
    setItems(mergeHifiOverlayItems(nextItems, nextConfig))
    setConfig({ ...nextConfig, overlayCompositorEnabled: Boolean(compositorEnabled) })
    setCustomOverlays(Array.isArray(nextCustom) ? nextCustom : [])
    setExpressions(Array.isArray(nextExpressions) ? nextExpressions : [])
    void refreshDisplays().catch(() => undefined)
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar overlays')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar overlays'))
    void refreshIracingGfx().catch(() => { /* status card stays in loading state */ })
    void refreshStreamingStatus().catch(() => { /* streaming module may be pending preload allowlist wiring */ })
    const off = window.ipc.subscribe<OverlayListItem[]>('overlays:state', (nextItems) => {
      setConfig((current) => {
        const nextConfig = mergeHifiOverlayConfigs(configModeFrom(nextItems, current))
        setItems(mergeHifiOverlayItems(nextItems, nextConfig))
        return nextConfig
      })
    })
    const offCustom = window.ipc.subscribe<CustomOverlayListItem[]>('overlays:customState', (nextCustom) => {
      setCustomOverlays(Array.isArray(nextCustom) ? nextCustom : [])
    })
    const offCompositor = window.ipc.subscribe<boolean>('overlays:compositorEnabled', (enabled) => {
      setConfig((current) => ({ ...current, overlayCompositorEnabled: Boolean(enabled) }))
    })
    return () => {
      off()
      offCustom()
      offCompositor()
    }
  }, [])

  function patchItem(id: OverlayWidgetId, patch: Partial<OverlayListItem>): void {
    setItems((currentItems) => currentItems.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function positionDraftKey(id: OverlayWidgetId, key: keyof OverlayPosition): string {
    return `${id}:${key}`
  }

  function onPositionInput(id: OverlayWidgetId, key: keyof OverlayPosition, raw: string): void {
    setPosDrafts((drafts) => ({ ...drafts, [positionDraftKey(id, key)]: raw }))
    const numericValue = Number(raw)
    // Live-update the preview only when the field holds a complete number.
    // Intermediate states like "" or "-" stay as drafts so the user can type
    // negative coordinates (secondary monitor positioned left of / above the
    // primary one), which a controlled type="number" input silently dropped.
    if (raw.trim() !== '' && raw.trim() !== '-' && Number.isFinite(numericValue)) {
      const current = items.find((item) => item.id === id)
      if (current) patchItem(id, { position: { ...current.position, [key]: numericValue } })
    }
  }

  function commitPosition(id: OverlayWidgetId, key: keyof OverlayPosition): void {
    const draftKey = positionDraftKey(id, key)
    const raw = posDrafts[draftKey]
    setPosDrafts((drafts) => {
      const next = { ...drafts }
      delete next[draftKey]
      return next
    })
    const current = items.find((item) => item.id === id)
    if (!current) return
    const numericValue = raw === undefined ? current.position[key] : Number(raw)
    const nextPosition = Number.isFinite(numericValue)
      ? { ...current.position, [key]: numericValue }
      : current.position
    patchItem(id, { position: nextPosition })
    void run(async () => {
      await window.ipc.invoke('overlays:setPosition', id, nextPosition)
    })
  }

  function selectedDisplayValue(item: OverlayListItem): string {
    if (!item.display) return 'auto'
    return displays.some((display) => display.id === item.display?.id) ? String(item.display.id) : `missing:${item.display.id}`
  }

  function selectedDisplayLabel(item: OverlayListItem): string {
    if (!item.display) return 'Auto — current/primary display'
    return displays.find((display) => display.id === item.display?.id)?.label ?? `Saved display unavailable (${item.display.bounds.width}×${item.display.bounds.height})`
  }

  function changeDisplay(id: OverlayWidgetId, value: string): void {
    const parsed = value === 'auto' || value.startsWith('missing:') ? null : Number(value)
    const displayId = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
    void run(async () => {
      const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setDisplayTarget', id, displayId)
      setItems(nextItems)
    })
  }

  function updateStyle(id: OverlayWidgetId, key: keyof OverlayWidgetStyle, value: string | number): void {
    const current = items.find((item) => item.id === id)
    if (!current) return
    patchItem(id, { style: { ...current.style, [key]: value } })
  }

  function toggleEditMode(): void {
    void run(async () => {
      const next = await window.ipc.invoke<OverlaysConfig>('overlays:setConfig', { configMode: !config.configMode })
      setConfig((current) => ({ ...next, overlayCompositorEnabled: current.overlayCompositorEnabled ?? false }))
    })
  }

  function toggleCompositorMode(): void {
    void run(async () => {
      const enabled = await window.ipc.invoke<boolean>('overlays:setCompositorEnabled', !config.overlayCompositorEnabled)
      setConfig((current) => ({ ...current, overlayCompositorEnabled: enabled }))
    })
  }

  function patchCustomLocal(id: string, patch: Partial<CustomOverlayListItem>): void {
    setCustomOverlays((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function applyCustomPatch(id: string, patch: Partial<CustomOverlayDef>): void {
    void run(async () => {
      const next = await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', id, patch)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
  }

  function toggleWidgetSelected(id: string): void {
    setSelectedWidgetIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCustomSelected(id: string): void {
    setSelectedCustomIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setWidgetHidden(ids: string[], hidden: boolean): void {
    if (ids.length === 0) return
    void run(async () => {
      for (const id of ids) {
        await window.ipc.invoke<OverlayListItem[]>('overlays:setHidden', id as OverlayWidgetId, hidden)
      }
      setSelectedWidgetIds(new Set())
    })
  }

  function setCustomHidden(ids: string[], hidden: boolean): void {
    if (ids.length === 0) return
    void run(async () => {
      for (const id of ids) {
        await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', id, { hidden })
      }
      setSelectedCustomIds(new Set())
    })
  }

  function toggleWidgetFavorite(id: OverlayWidgetId, favorite: boolean): void {
    void run(async () => {
      const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setFavorite', id, favorite)
      setItems(nextItems)
    })
  }

  function toggleActiveFavorite(entry: ActiveOverlayEntry): void {
    if (entry.kind === 'widget') toggleWidgetFavorite(entry.id as OverlayWidgetId, !entry.favorite)
    else applyCustomPatch(entry.id, { favorite: !entry.favorite })
  }

  function deactivateOverlay(entry: ActiveOverlayEntry): void {
    if (entry.kind === 'widget') {
      void run(async () => {
        const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:toggle', entry.id as OverlayWidgetId, false)
        setItems(nextItems)
      })
    } else {
      applyCustomPatch(entry.id, { enabled: false })
    }
  }

  function removeCustomOverlay(id: string): void {
    if (!window.confirm('Remove this custom overlay? This action cannot be undone.')) return
    void run(async () => {
      const next = await window.ipc.invoke<CustomOverlayListItem[]>('overlays:removeCustom', id)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
  }

  function loadExpressionsForDesigner(): void {
    void window.ipc
      .invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions)
      .then((entries) => { if (Array.isArray(entries)) setExpressions(entries) })
      .catch(() => undefined)
  }

  function openDesignerForNew(): void {
    setEditingId(null)
    setDraft(createCustomOverlayDef({ enabled: true, title: 'Novo overlay', elements: [createCustomOverlayElement()] }))
    setDesignerOpen(true)
    loadExpressionsForDesigner()
  }

  function openDesignerForEdit(overlay: CustomOverlayListItem): void {
    setEditingId(overlay.id)
    setDraft(createCustomOverlayDef(overlay))
    setDesignerOpen(true)
    loadExpressionsForDesigner()
  }

  function closeDesigner(): void {
    setDesignerOpen(false)
    setDraft(null)
    setEditingId(null)
  }

  function updateDraft(patch: Partial<CustomOverlayDef>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  function updateDraftElement(elementId: string, patch: Partial<CustomOverlayElement>): void {
    setDraft((current) => current ? {
      ...current,
      elements: current.elements.map((element) => (element.id === elementId ? { ...element, ...patch } : element))
    } : current)
  }

  function addDraftElement(): void {
    setDraft((current) => (current ? { ...current, elements: [...current.elements, createCustomOverlayElement()] } : current))
  }

  function removeDraftElement(elementId: string): void {
    setDraft((current) => current ? { ...current, elements: current.elements.filter((element) => element.id !== elementId) } : current)
  }

  function bindElementExpression(elementId: string, selection: string): void {
    // Raw telemetry channel binding (`channel:<VarId>`): store the var id as the
    // element formula so the overlay widget evaluates it directly against the snapshot.
    const channelVarId = channelVarIdFromBinding(selection)
    if (channelVarId) {
      const variable = IRACING_VARIABLES.find((item) => item.id === channelVarId)
      setDraft((current) => current ? {
        ...current,
        elements: current.elements.map((element) => {
          if (element.id !== elementId) return element
          return {
            ...element,
            expressionId: selection,
            expression: channelVarId,
            expressionName: variable?.label ?? channelVarId,
            label: element.label.trim() ? element.label : (variable?.label ?? channelVarId)
          }
        })
      } : current)
      return
    }

    // Saved expression binding (existing behaviour).
    const expression = expressions.find((item) => item.id === selection)
    setDraft((current) => current ? {
      ...current,
      elements: current.elements.map((element) => {
        if (element.id !== elementId) return element
        return {
          ...element,
          expressionId: selection,
          expression: expression?.expr ?? (selection ? element.expression : ''),
          expressionName: expression?.name ?? '',
          label: element.label.trim() ? element.label : (expression?.name ?? element.label)
        }
      })
    } : current)
  }

  function saveDesigner(): void {
    if (!draft) return
    const payload = draft
    const targetId = editingId
    void run(async () => {
      const next = targetId
        ? await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', targetId, payload)
        : await window.ipc.invoke<CustomOverlayListItem[]>('overlays:addCustom', payload)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
    closeDesigner()
  }

  // ── Rich widget builder ("Create new overlay") ──────────────────────────────
  function openBuilderForNew(): void {
    setBuilderEditingId(null)
    setBuilderDraft(createRichCustomOverlayDef({ enabled: true, title: 'Novo overlay' }))
    setBuilderOpen(true)
  }

  function openBuilderForEdit(overlay: CustomOverlayListItem): void {
    setBuilderEditingId(overlay.id)
    // Ensure a rich shape (widgets array present) even if some fields were stripped.
    setBuilderDraft(createRichCustomOverlayDef(overlay))
    setBuilderOpen(true)
  }

  function closeBuilder(): void {
    setBuilderOpen(false)
    setBuilderDraft(null)
    setBuilderEditingId(null)
  }

  function saveBuilder(payload: CustomOverlayDef): void {
    const targetId = builderEditingId
    void run(async () => {
      const next = targetId
        ? await window.ipc.invoke<CustomOverlayListItem[]>('overlays:updateCustom', targetId, payload)
        : await window.ipc.invoke<CustomOverlayListItem[]>('overlays:addCustom', payload)
      if (Array.isArray(next)) setCustomOverlays(next)
    })
    closeBuilder()
  }

  // Route the "Edit" action by overlay flavour: rich overlays open the widget
  // builder, legacy (expression/channel) overlays open the original designer.
  function editCustomOverlay(overlay: CustomOverlayListItem): void {
    if (isRichCustomOverlay(overlay)) openBuilderForEdit(overlay)
    else openDesignerForEdit(overlay)
  }

  return (
    <div className="overlays-view">
      <section className="panel overlays-header">
        <div>
          <h3>On-screen overlays</h3>
          <p>Janelas transparentes always-on-top no estilo SimHub, alimentadas pela telemetria ativa.</p>
          <p className="overlay-help">
            {config.configMode
              ? 'Edit mode on: floating overlays receive mouse input; drag to position and use edges/corners to resize.'
              : 'Race mode: pinned overlays are click-through (mouse passes to the sim); unpin an overlay to move it without turning on edit mode.'}
          </p>
        </div>
        <div className="overlay-actions">
          <SectionExportImport sectionId="overlays" label="Overlays (inclui customizados)" onImported={() => void refresh()} />
          <SectionExportImport sectionId="overlay-layout" label="Overlay layout/composition" onImported={() => void refresh()} />
          <button
            className={config.configMode ? 'overlay-button danger' : 'primary-action'}
            disabled={busy}
            onClick={toggleEditMode}
          >
            {config.configMode ? 'Turn off editing and race' : 'Edit/position overlays'}
          </button>
          <button
            className="ghost-action"
            disabled={busy || enabledCount === items.length}
            onClick={() => run(async () => {
              for (const item of items) await window.ipc.invoke('overlays:toggle', item.id, true)
            })}
          >
            Ligar todos
          </button>
          <button
            className="ghost-action"
            disabled={busy || enabledCount === 0}
            onClick={() => run(async () => {
              for (const item of items) await window.ipc.invoke('overlays:toggle', item.id, false)
            })}
          >
            Desligar todos
          </button>
        </div>
      </section>

      {activeOverlays.length > 0 && (
        <section className="panel overlays-active">
          <div className="overlays-active-head">
            <h3>Overlays ativos <span className="overlays-active-count">{activeOverlays.length}</span></h3>
            <p className="overlay-help">Quick shortcut for what is on screen now — favorite ⭐ or turn off without scrolling the list.</p>
          </div>
          <div className="overlays-active-chips">
            {activeOverlays.map((entry) => (
              <div key={entry.id} className="overlay-active-chip">
                <button
                  className={entry.favorite ? 'overlay-fav is-fav' : 'overlay-fav'}
                  disabled={busy}
                  title={entry.favorite ? 'Remove dos favoritos' : 'Favoritar'}
                  aria-label={entry.favorite ? 'Remove dos favoritos' : 'Favoritar'}
                  aria-pressed={entry.favorite}
                  onClick={() => toggleActiveFavorite(entry)}
                >
                  {entry.favorite ? '★' : '☆'}
                </button>
                <span className="overlay-active-chip-title">{entry.title}</span>
                <button
                  className="overlay-active-chip-off"
                  disabled={busy}
                  title="Desligar overlay"
                  onClick={() => deactivateOverlay(entry)}
                >
                  Desligar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>How to position</h4>
        <p className="overlay-help">
          Turn on <strong style={{ color: "var(--accent-primary)" }}>Edit/position overlays</strong> to adjust all overlays at once. Or, with editing off, click <strong style={{ color: "var(--accent-primary)" }}>Floating</strong> on the overlay you want to adjust - it becomes draggable/resizable immediately. Click <strong style={{ color: "var(--accent-primary)" }}>Pinned</strong> to return to click-through in the race.
        </p>
        <label className="designer-check" style={{ margin: '12px 0 0' }}>
          <input
            type="checkbox"
            checked={Boolean(config.overlayCompositorEnabled)}
            disabled={busy}
            onChange={toggleCompositorMode}
          />
          Compositor mode (experimental): one transparent window per display rendering all active widgets
        </label>
        <p className="overlay-help" style={{ marginTop: 8 }}>
          Off by default: keeps the current one-window-per-widget mode. Turn it on only to test the compositor.
        </p>
      </section>

      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>iRacing Fullscreen</h4>
          {iracingGfx && (
            <span className={iracingGfx.mode === 'exclusive' ? 'status-pill' : 'status-pill on'}>
              {iracingGfx.mode === 'exclusive' ? 'exclusive fullscreen'
                : iracingGfx.mode === 'borderless' ? 'borderless ✓'
                : iracingGfx.mode === 'windowed' ? 'windowed'
                : 'unknown mode'}
            </span>
          )}
        </div>
        <p className="overlay-help">
          {iracingGfx ? iracingGfx.message : 'Checking iRacing video mode...'}
        </p>
        <p className="overlay-help">
          Window overlays <strong style={{ color: "var(--accent-primary)" }}>never</strong> appear over <strong style={{ color: "var(--accent-primary)" }}>exclusive</strong> DirectX fullscreen - this also applies to SimHub/RaceLab. The solution is to run iRacing in <strong style={{ color: "var(--accent-primary)" }}>Borderless</strong>. Rendering over exclusive fullscreen would require DirectX injection (a separate project with anti-cheat risk).
        </p>
        <div className="overlay-actions">
          <button
            className="primary-action"
            disabled={busy || !iracingGfx?.supported || iracingGfx?.mode === 'borderless' || iracingGfx?.mode === 'windowed'}
            onClick={() => void fixIracingFullscreen()}
            title={iracingGfx?.supported ? 'Edits iRacing app.ini (with backup) for borderless mode' : 'Available only on Windows'}
          >
            Fix: switch iRacing to borderless
          </button>
          <button className="ghost-action" disabled={busy} onClick={() => void refreshIracingGfx()}>
            Check again
          </button>
        </div>
        {gfxNote && <p className="overlay-help" style={{ color: 'var(--accent-success)' }}>{gfxNote}</p>}
      </section>

      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>OBS / Streaming</h4>
          <span className={streamingStatus?.running ? 'status-pill on' : 'status-pill'}>
            {streamingStatus?.running ? `online · ${streamingStatus.clients} client(s)` : 'offline'}
          </span>
        </div>
        <p className="overlay-help">
          Starts a local server for OBS or, optionally, on the LAN for phones/tablets. Telemetry arrives through SSE and the stream-safe mask is applied on the server.
        </p>
        {streamingStatus?.warning ? (
          <p className="overlay-help" style={{ color: 'var(--accent-warning, #fbbf24)' }}>
            ⚠ {streamingStatus.warning}
          </p>
        ) : null}
        <label className="designer-check" style={{ margin: '12px 0' }}>
          <input
            type="checkbox"
            checked={streamSafe}
            disabled={busy || Boolean(streamingStatus?.running)}
            onChange={(event) => setStreamSafe(event.target.checked)}
          />
          Stream-safe: hide names, iRating/SR, and private tags before sending to OBS
        </label>
        <label className="designer-check" style={{ margin: '12px 0' }}>
          <input
            type="checkbox"
            checked={streamLanEnabled}
            disabled={busy || Boolean(streamingStatus?.running)}
            onChange={(event) => setStreamLanEnabled(event.target.checked)}
          />
          Enable LAN access (generates URL/QR for phones and tablets)
        </label>
        <label className="designer-field" style={{ margin: '12px 0' }}>
          Optional password (alternative to token; not shown after starting)
          <input
            type="password"
            value={streamPassword}
            disabled={busy || Boolean(streamingStatus?.running)}
            placeholder="Opcional"
            onChange={(event) => setStreamPassword(event.target.value)}
          />
        </label>
        <div className="overlay-actions">
          <button className="primary-action" disabled={busy || Boolean(streamingStatus?.running)} onClick={() => void startStreaming()}>
            Iniciar streaming
          </button>
          <button className="ghost-action danger" disabled={busy || !streamingStatus?.running} onClick={() => void stopStreaming()}>
            Parar
          </button>
          <button className="ghost-action" disabled={busy} onClick={() => void refreshStreamingStatus()}>
            Refresh status
          </button>
        </div>
        {streamingStatus?.url ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label className="designer-field">
              Dashboard URL (OBS/browser)
              <input readOnly value={streamingStatus.url} onFocus={(event) => event.currentTarget.select()} />
            </label>
            {streamingStatus.touchUrl ? (
              <label className="designer-field">
                Touch Controls Dash URL (phone/tablet)
                <input readOnly value={streamingStatus.touchUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
            ) : (
              <p className="overlay-help">Create a Touch Controls Dash to show the second QR/URL.</p>
            )}
            {(streamingStatus.qrDataUrl || streamingStatus.touchQrDataUrl) ? (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {streamingStatus.qrDataUrl ? (
                  <div>
                    <div className="overlay-help" style={{ marginBottom: 6 }}>QR dashboard</div>
                    <img src={streamingStatus.qrDataUrl} alt="Dashboard QR" style={{ width: 152, height: 152, borderRadius: 12 }} />
                  </div>
                ) : null}
                {streamingStatus.touchQrDataUrl ? (
                  <div>
                    <div className="overlay-help" style={{ marginBottom: 6 }}>QR Touch Controls</div>
                    <img src={streamingStatus.touchQrDataUrl} alt="Touch Controls QR" style={{ width: 152, height: 152, borderRadius: 12 }} />
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="overlay-actions">
              <button className="ghost-action" onClick={() => void copyStreamUrl()}>
                {copiedStreamUrl ? 'Copiado ✓' : 'Copiar dashboard'}
              </button>
              <button className="ghost-action" disabled={!streamingStatus.touchUrl} onClick={() => void copyTouchStreamUrl()}>
                Copiar Touch Controls
              </button>
            </div>
          </div>
        ) : (
          <p className="overlay-help" style={{ marginTop: 10 }}>
            After starting, the tokenized URL will appear here.
          </p>
        )}
      </section>

      <section className="panel custom-overlays-panel">
        <div className="custom-overlays-head">
          <div>
            <h4 style={{ margin: '0 0 6px', color: '#f6fbff' }}>Overlays customizados</h4>
            <p className="overlay-help">
              Build your own overlays with the full set of <strong style={{ color: 'var(--accent-primary)' }}>dashboard widgets</strong> (medidores, marcha, pneus, radar, imagens…) or with simple cards from <strong style={{ color: 'var(--accent-primary)' }}>Expressions</strong>. Each one becomes an independent transparent window.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="primary-action" disabled={busy} onClick={openBuilderForNew}>
              + Create new overlay
            </button>
            <button className="ghost-action" disabled={busy} onClick={openDesignerForNew}>
              + Expression overlay
            </button>
          </div>
        </div>

        {visibleCustomOverlays.length === 0 ? (
          <p className="overlay-help">
            No custom overlays yet. Click <strong style={{ color: "var(--accent-primary)" }}>Create new overlay</strong> to build with dashboard widgets.
          </p>
        ) : (
          <div className="overlay-grid">
            {visibleCustomOverlays.map((overlay) => (
              <article key={overlay.id} className={overlay.enabled ? 'overlay-config-card is-enabled' : 'overlay-config-card'}>
                <div className="overlay-card-top">
                  <div>
                    <label className="designer-check" style={{ margin: '0 0 6px' }}>
                      <input
                        type="checkbox"
                        checked={selectedCustomIds.has(overlay.id)}
                        disabled={busy}
                        onChange={() => toggleCustomSelected(overlay.id)}
                      />
                      Select
                    </label>
                    <h4>{overlay.title}</h4>
                    <p>
                      {isRichCustomOverlay(overlay)
                        ? `${overlay.widgets?.length ?? 0} widget(s) · dashboard ao vivo`
                        : `${overlay.elements.length} element(s) · live expressions`}
                    </p>
                  </div>
                  <div className="overlay-card-badges">
                    <button
                      className={overlay.favorite ? 'overlay-fav is-fav' : 'overlay-fav'}
                      disabled={busy}
                      title={overlay.favorite ? 'Remove dos favoritos' : 'Favoritar'}
                      aria-label={overlay.favorite ? 'Remove dos favoritos' : 'Favoritar'}
                      aria-pressed={overlay.favorite}
                      onClick={() => applyCustomPatch(overlay.id, { favorite: !overlay.favorite })}
                    >
                      {overlay.favorite ? '★' : '☆'}
                    </button>
                    <span className={overlay.enabled ? 'status-pill on' : 'status-pill'}>{overlay.enabled ? 'ativo' : 'off'}</span>
                  </div>
                </div>

                <div className="overlay-toggles">
                  <button
                    className={overlay.enabled ? 'overlay-button danger' : 'primary-action'}
                    disabled={busy}
                    onClick={() => applyCustomPatch(overlay.id, { enabled: !overlay.enabled })}
                  >
                    {overlay.enabled ? 'Desligar' : 'Ligar'}
                  </button>
                  <button
                    className="ghost-action"
                    disabled={busy || !overlay.enabled}
                    onClick={() => applyCustomPatch(overlay.id, { locked: !overlay.locked })}
                  >
                    {overlay.locked ? 'Pinned' : 'Floating'}
                  </button>
                  <button className="ghost-action" disabled={busy} onClick={() => editCustomOverlay(overlay)}>
                    Edit
                  </button>
                  <button className="ghost-action danger" disabled={busy} onClick={() => removeCustomOverlay(overlay.id)}>
                    Remove
                  </button>
                  <button className="ghost-action" disabled={busy} onClick={() => setCustomHidden([overlay.id], true)}>
                    Hide
                  </button>
                </div>

                <div className="opacity-control">
                  <label>
                    Opacidade <strong style={{ color: "var(--accent-primary)" }}>{overlay.opacity}%</strong>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={overlay.opacity}
                      disabled={busy || !overlay.enabled}
                      onChange={(event) => patchCustomLocal(overlay.id, { opacity: Number(event.target.value) })}
                      onMouseUp={(event) => applyCustomPatch(overlay.id, { opacity: Number(event.currentTarget.value) })}
                      onTouchEnd={(event) => applyCustomPatch(overlay.id, { opacity: Number(event.currentTarget.value) })}
                    />
                  </label>
                </div>

                {!isRichCustomOverlay(overlay) && (
                  <div className="preset-row">
                    {OVERLAY_FORMS.map((preset) => (
                      <button
                        key={preset.id}
                        className={isSelectedOverlayForm(overlay.stylePreset, preset.id) ? 'preset-button active' : 'preset-button'}
                        disabled={busy}
                        title={preset.description}
                        onClick={() => applyCustomPatch(overlay.id, { stylePreset: preset.id, style: preset.style })}
                      >
                        {preset.title}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {(visibleCustomOverlays.length > 0 || hiddenCustomOverlays.length > 0) && (
          <div className="overlay-actions" style={{ marginTop: 12 }}>
            <button className="ghost-action" disabled={busy || selectedCustomIds.size === 0} onClick={() => setCustomHidden(Array.from(selectedCustomIds), true)}>
              Hide selected
            </button>
          </div>
        )}
        {hiddenCustomOverlays.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ color: '#f6fbff', cursor: 'pointer', fontWeight: 700 }}>Hidden custom overlays ({hiddenCustomOverlays.length})</summary>
            <div className="overlays-active-chips" style={{ marginTop: 10 }}>
              {hiddenCustomOverlays.map((overlay) => (
                <div key={overlay.id} className="overlay-active-chip">
                  <label className="designer-check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={selectedCustomIds.has(overlay.id)} onChange={() => toggleCustomSelected(overlay.id)} />
                    <span className="overlay-active-chip-title">{overlay.title}</span>
                  </label>
                  <button className="overlay-active-chip-off" disabled={busy} onClick={() => setCustomHidden([overlay.id], false)}>Restore</button>
                </div>
              ))}
            </div>
            <button className="ghost-action" style={{ marginTop: 10 }} disabled={busy || selectedCustomIds.size === 0} onClick={() => setCustomHidden(Array.from(selectedCustomIds), false)}>Restore selected</button>
          </details>
        )}
      </section>

      {error && <section className="panel overlay-help">{error}</section>}

      <section className="overlay-grid">
        <div className="overlay-yes-filter" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Filter by Sim</span>
          {(['all', ...PLAYABLE_SIMS] as const).map((yes) => (
            <button
              key={yes}
              type="button"
              className={simFilter === yes ? 'overlay-fav is-fav' : 'overlay-fav'}
              onClick={() => setSimFilter(yes)}
              style={{ padding: '2px 10px', fontSize: 12 }}
            >
              {yes === 'all' ? 'All' : simLabel(yes)}
            </button>
          ))}
          {simFilter !== 'all' && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{visibleItems.length} widget(s) with live telemetry in this yes</span>
          )}
          <span style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 2px' }} />
          <TagFilter
            items={simFilteredItems}
            selectedTags={tagFilters}
            onSelectedTagsChange={setTagFilters}
            getTags={(item) => definitionTags(defById.get(item.id as OverlayWidgetId))}
          />
          <button className="ghost-action" disabled={busy || selectedWidgetIds.size === 0} onClick={() => setWidgetHidden(Array.from(selectedWidgetIds), true)}>
            Hide selected
          </button>
        </div>
        {visibleItems.map((item) => (
          <article key={item.id} className={item.enabled ? 'overlay-config-card is-enabled' : 'overlay-config-card'}>
            <div className="overlay-card-top">
              <div>
                <label className="designer-check" style={{ margin: '0 0 6px' }}>
                  <input
                    type="checkbox"
                    checked={selectedWidgetIds.has(item.id)}
                    disabled={busy}
                    onChange={() => toggleWidgetSelected(item.id)}
                  />
                  Select
                </label>
                <h4>{displayTitleFor(item.id, item.title)}</h4>
                <p>{item.description}</p>
              </div>
              <div className="overlay-card-badges">
                <button
                  className={item.favorite ? 'overlay-fav is-fav' : 'overlay-fav'}
                  disabled={busy}
                  title={item.favorite ? 'Remove dos favoritos' : 'Favoritar'}
                  aria-label={item.favorite ? 'Remove dos favoritos' : 'Favoritar'}
                  aria-pressed={item.favorite}
                  onClick={() => toggleWidgetFavorite(item.id, !item.favorite)}
                >
                  {item.favorite ? '★' : '☆'}
                </button>
                <span className={item.enabled ? 'status-pill on' : 'status-pill'}>{item.enabled ? 'ativo' : 'off'}</span>
              </div>
            </div>

            <div className="overlay-toggles">
              <button
                className={item.enabled ? 'overlay-button danger' : 'primary-action'}
                disabled={busy}
                onClick={() => run(async () => {
                  const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:toggle', item.id)
                  setItems(nextItems)
                })}
              >
                {item.enabled ? 'Desligar' : 'Ligar'}
              </button>
              <button
                className="ghost-action"
                disabled={busy || !item.enabled}
                onClick={() => run(async () => {
                  const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setLocked', item.id, !item.locked)
                  setItems(nextItems)
                })}
              >
                {item.locked ? 'Pinned' : 'Floating'}
              </button>
              <button
                className="ghost-action"
                disabled={busy || !item.enabled}
                onClick={() => run(async () => {
                  const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setPosition', item.id, item.position)
                  setItems(nextItems)
                })}
              >
                Apply position
              </button>
              <button className="ghost-action" disabled={busy} onClick={() => setWidgetHidden([item.id], true)}>
                Hide
              </button>
            </div>

            <label className="monitor-control">
              Monitor / mover overlay
              <select
                value={selectedDisplayValue(item)}
                disabled={busy}
                onChange={(event) => changeDisplay(item.id, event.target.value)}
                title={selectedDisplayLabel(item)}
              >
                <option value="auto">Auto — current/primary display</option>
                {item.display && !displays.some((display) => display.id === item.display?.id) && (
                  <option value={`missing:${item.display.id}`}>{selectedDisplayLabel(item)}</option>
                )}
                {displayOptions.map((display) => <option key={display.value} value={display.value}>{display.label}</option>)}
              </select>
            </label>

            <div className="position-grid">
              {POSITION_KEYS.map((key) => (
                <label key={key}>
                  {key}
                  <input
                    className="position-input"
                    type="text"
                    inputMode="numeric"
                    value={posDrafts[positionDraftKey(item.id, key)] ?? String(item.position[key])}
                    disabled={busy}
                    onChange={(event) => onPositionInput(item.id, key, event.target.value)}
                    onBlur={() => commitPosition(item.id, key)}
                  />
                </label>
              ))}
            </div>

            <div className="opacity-control">
              <label>
                Opacidade <strong style={{ color: "var(--accent-primary)" }}>{item.opacity}%</strong>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={item.opacity}
                  disabled={busy || !item.enabled}
                  onChange={(event) => patchItem(item.id, { opacity: Number(event.target.value) })}
                  onMouseUp={(event) => run(async () => {
                    await window.ipc.invoke('overlays:setOpacity', item.id, Number(event.currentTarget.value))
                  })}
                  onTouchEnd={(event) => run(async () => {
                    await window.ipc.invoke('overlays:setOpacity', item.id, Number(event.currentTarget.value))
                  })}
                />
              </label>
            </div>

            <div className="preset-row">
              {OVERLAY_FORMS.map((preset) => (
                <button
                  key={preset.id}
                  className={isSelectedOverlayForm(item.stylePreset, preset.id) ? 'preset-button active' : 'preset-button'}
                  disabled={busy}
                  title={preset.description}
                  onClick={() => run(async () => {
                    const nextItems = await window.ipc.invoke<OverlayListItem[]>('overlays:setStyle', item.id, {
                      stylePreset: preset.id,
                      style: preset.style
                    })
                    setItems(nextItems)
                  })}
                >
                  {preset.title}
                </button>
              ))}
            </div>

            <div className="style-grid">
              <label>
                Fundo
                <input
                  type="color"
                  value={item.style.background.startsWith('#') ? item.style.background : '#050a12'}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'background', event.target.value)}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
              <label>
                Accent
                <input
                  type="color"
                  value={item.style.accent.startsWith('#') ? item.style.accent : 'var(--accent-primary)'}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'accent', event.target.value)}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
              <label>
                Borda
                <input
                  type="color"
                  value={item.style.border.startsWith('#') ? item.style.border : '#8aa4c8'}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'border', event.target.value)}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
              <label>
                Raio
                <input
                  className="position-input"
                  type="number"
                  min="0"
                  max="36"
                  value={item.style.radius}
                  disabled={busy}
                  onChange={(event) => updateStyle(item.id, 'radius', Number(event.target.value))}
                  onBlur={() => run(async () => {
                    await window.ipc.invoke('overlays:setStyle', item.id, { style: item.style })
                  })}
                />
              </label>
            </div>

            <label className="font-control">
              Font
              <select
                value={item.style.fontFamily}
                disabled={busy}
                onChange={(event) => run(async () => {
                  const nextStyle = { ...item.style, fontFamily: event.target.value }
                  patchItem(item.id, { style: nextStyle })
                  await window.ipc.invoke('overlays:setStyle', item.id, { style: nextStyle })
                })}
              >
                {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}
              </select>
            </label>
          </article>
        ))}
        {hiddenItems.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <details>
              <summary style={{ color: '#f6fbff', cursor: 'pointer', fontWeight: 800 }}>Hidden widgets ({hiddenItems.length})</summary>
              <div className="overlays-active-chips" style={{ marginTop: 10 }}>
                {hiddenItems.map((item) => (
                  <div key={item.id} className="overlay-active-chip">
                    <label className="designer-check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={selectedWidgetIds.has(item.id)} onChange={() => toggleWidgetSelected(item.id)} />
                      <span className="overlay-active-chip-title">{displayTitleFor(item.id, item.title)}</span>
                    </label>
                    <button className="overlay-active-chip-off" disabled={busy} onClick={() => setWidgetHidden([item.id], false)}>Restore</button>
                  </div>
                ))}
              </div>
              <button className="ghost-action" style={{ marginTop: 10 }} disabled={busy || selectedWidgetIds.size === 0} onClick={() => setWidgetHidden(Array.from(selectedWidgetIds), false)}>Restore selected</button>
            </details>
          </div>
        )}
      </section>


      {designerOpen && draft && (
        <div className="overlay-designer-backdrop" role="dialog" aria-modal="true">
          <div className="overlay-designer">
            <div className="overlay-designer-head">
              <h4>{editingId ? 'Edit overlay customizado' : 'Novo overlay customizado'}</h4>
              <button className="ghost-action" disabled={busy} onClick={closeDesigner}>Close</button>
            </div>

            <div className="overlay-designer-body">
              <label className="designer-field">
                Title
                <input
                  type="text"
                  value={draft.title}
                  disabled={busy}
                  maxLength={60}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                />
              </label>

              <div className="designer-settings">
                <label className="designer-check">
                  <input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => updateDraft({ enabled: event.target.checked })} />
                  Show overlay
                </label>
                <label className="designer-check">
                  <input type="checkbox" checked={draft.locked} disabled={busy} onChange={(event) => updateDraft({ locked: event.target.checked })} />
                  Pinned (click-through)
                </label>
                <label className="designer-field">
                  Style
                  <select
                    value={draft.stylePreset}
                    disabled={busy}
                    onChange={(event) => {
                      const preset = OVERLAY_FORMS.find((item) => item.id === event.target.value)
                      if (preset) updateDraft({ stylePreset: preset.id, style: { ...preset.style } })
                    }}
                  >
                    {OVERLAY_FORMS.map((preset) => <option key={preset.id} value={preset.id}>{preset.title}</option>)}
                  </select>
                </label>
              </div>

              {expressions.length === 0 && BINDABLE_TELEMETRY_COUNT === 0 && (
                <p className="overlay-help">
                  No saved expressions and no telemetry channel available. Create expressions in <strong style={{ color: "var(--accent-primary)" }}>Expressions</strong> to link them to elements.
                </p>
              )}
              {expressions.length === 0 && BINDABLE_TELEMETRY_COUNT > 0 && (
                <p className="overlay-help">
                  No saved expressions yet ? link a telemetry channel directly in the selector (group <strong style={{ color: "var(--accent-primary)" }}>Telemetry</strong>), or create expressions in the <strong style={{ color: "var(--accent-primary)" }}>Expressions</strong> menu.
                </p>
              )}

              <div className="designer-elements">
                {draft.elements.map((element, index) => (
                  <div key={element.id} className="designer-element">
                    <div className="designer-element-head">
                      <strong style={{ color: "var(--accent-primary)" }}>Elemento {index + 1}</strong>
                      <button className="ghost-action danger" disabled={busy} onClick={() => removeDraftElement(element.id)}>Remove</button>
                    </div>

                    <label className="designer-field">
                      Expression or channel
                      <select value={element.expressionId} disabled={busy} onChange={(event) => bindElementExpression(element.id, event.target.value)}>
                        <option value="">— choose expression or channel —</option>
                        {element.expressionId !== '' &&
                          channelVarIdFromBinding(element.expressionId) === null &&
                          !expressions.some((item) => item.id === element.expressionId) && (
                            <option value={element.expressionId}>{element.expressionName || 'removed expression'} (unavailable)</option>
                          )}
                        {element.expressionId !== '' &&
                          channelVarIdFromBinding(element.expressionId) !== null &&
                          !IRACING_VARIABLES.some((item) => `${CHANNEL_BINDING_PREFIX}${item.id}` === element.expressionId && item.telemetryField) && (
                            <option value={element.expressionId}>{element.expressionName || channelVarIdFromBinding(element.expressionId)} (channel unavailable)</option>
                          )}
                        {expressions.length > 0 && (
                          <optgroup label="My expressions">
                            {expressions.map((expression) => <option key={expression.id} value={expression.id}>{expression.name}</option>)}
                          </optgroup>
                        )}
                        {BINDABLE_TELEMETRY_GROUPS.map((group) => (
                          <optgroup key={group.category} label={`Telemetry · ${group.label}`}>
                            {group.variables.map((variable) => (
                              <option key={variable.id} value={`${CHANNEL_BINDING_PREFIX}${variable.id}`}>
                                {variable.label}{variable.unit ? ` (${variable.unit})` : ''} · {variable.id}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>

                    <div className="designer-grid-2">
                      <label className="designer-field">
                        Label
                        <input type="text" value={element.label} disabled={busy} maxLength={80} onChange={(event) => updateDraftElement(element.id, { label: event.target.value })} />
                      </label>
                      <label className="designer-field">
                        Sufixo
                        <input type="text" value={element.suffix} disabled={busy} maxLength={16} onChange={(event) => updateDraftElement(element.id, { suffix: event.target.value })} />
                      </label>
                    </div>

                    <div className="designer-grid-4">
                      <label className="designer-field">
                        Casas
                        <select
                          value={element.decimals === null ? 'auto' : String(element.decimals)}
                          disabled={busy}
                          onChange={(event) => updateDraftElement(element.id, { decimals: event.target.value === 'auto' ? null : Number(event.target.value) })}
                        >
                          {DECIMALS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="designer-field">
                        Font (px)
                        <input type="number" min={8} max={240} value={element.fontSize} disabled={busy} onChange={(event) => updateDraftElement(element.id, { fontSize: Number(event.target.value) })} />
                      </label>
                      <label className="designer-field">
                        Alinhar
                        <select value={element.align} disabled={busy} onChange={(event) => updateDraftElement(element.id, { align: event.target.value as CustomOverlayElementAlign })}>
                          {ALIGN_OPTIONS.map((align) => <option key={align} value={align}>{align}</option>)}
                        </select>
                      </label>
                      <label className="designer-field">
                        Color
                        <input
                          type="color"
                          value={element.color && element.color.startsWith('#') ? element.color : 'var(--accent-primary)'}
                          disabled={busy || element.color === ''}
                          onChange={(event) => updateDraftElement(element.id, { color: event.target.value })}
                        />
                      </label>
                    </div>

                    <label className="designer-check">
                      <input
                        type="checkbox"
                        checked={element.color === ''}
                        disabled={busy}
                        onChange={(event) => updateDraftElement(element.id, { color: event.target.checked ? '' : 'var(--accent-primary)' })}
                      />
                      Use theme color (accent)
                    </label>

                    <div className="designer-grid-4">
                      {ELEMENT_BOX_KEYS.map((key) => (
                        <label key={key} className="designer-field">
                          {key}
                          <input
                            type="number"
                            value={element[key]}
                            disabled={busy}
                            onChange={(event) => updateDraftElement(element.id, { [key]: Number(event.target.value) } as Partial<CustomOverlayElement>)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button className="ghost-action" disabled={busy} onClick={addDraftElement}>+ Add elemento</button>
            </div>

            <div className="overlay-designer-foot">
              <button className="ghost-action" disabled={busy} onClick={closeDesigner}>Cancel</button>
              <button className="primary-action" disabled={busy || !draft.title.trim()} onClick={saveDesigner}>
                {editingId ? 'Save changes' : 'Create overlay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {builderOpen && builderDraft && (
        <OverlayWidgetBuilder
          initial={builderDraft}
          editing={Boolean(builderEditingId)}
          busy={busy}
          onSave={saveBuilder}
          onCancel={closeBuilder}
        />
      )}
    </div>
  )
}
