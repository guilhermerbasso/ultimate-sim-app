import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { evaluateExpression, flattenExpressionScope } from '../../../shared/expr-eval'
import {
  buildIracingExpressionScope,
  getIracingTelemetryValue,
  IRACING_VAR_CATEGORY_LABELS,
  IRACING_VAR_CATEGORY_ORDER,
  IRACING_VARIABLES
} from '../../../shared/iracing-vars'
import {
  EXPR_CHANNELS,
  type EnabledIracingVars,
  type ExpressionDef,
  type ExpressionResultEntry,
  type ExpressionResultsBatch,
  type ExpressionValue
} from '../../../shared/expr'
import {
  OUTPUTS_CHANNELS,
  type OutputRoute,
  type OutputTarget,
  type OutputTargetKind
} from '../../../shared/outputs'
import {
  ARDUINO_CHANNELS,
  type ArduinoDevicesChangedPayload,
  type SerialDeviceSummary
} from '../../../shared/arduino'
import { OVERLAY_WIDGETS } from '../../../shared/overlays'
import { BUILTIN_PRESETS, type DashboardSummary } from '../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { AppViewProps } from '../App'
import { getLatestTelemetry, onTelemetry } from '../lib/telemetry'
import { SectionExportImport } from '../components/SectionExportImport'

const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 16,
  
}

const label: CSSProperties = { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.62 }
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '10px 11px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(0,0,0,0.22)',
  color: '#fff'
}

function blankExpression(): ExpressionDef {
  return { id: `expr-${Date.now()}`, name: 'Nova expressão', expr: 'speedKmh > 100 ? "rápido" : "lento"' }
}

// ─── Targets / OutputRoute helpers ──────────────────────────────────────────

const TARGET_KIND_LABELS: Record<OutputTargetKind, string> = {
  dashboardVar: 'Dashboard',
  dashboard: 'Trocar dashboard',
  overlay: 'Overlay',
  serial: 'Serial (ButtonBox / dispositivo)',
  secondScreen: 'Segunda tela'
}

const TARGET_KIND_ORDER: OutputTargetKind[] = ['dashboardVar', 'dashboard', 'overlay', 'serial', 'secondScreen']

interface TargetOption {
  id: string
  label: string
  hint?: string
}

const OVERLAY_TARGET_OPTIONS: TargetOption[] = OVERLAY_WIDGETS.map((widget) => ({
  id: widget.id,
  label: widget.title,
  hint: widget.id
}))

const SECOND_SCREEN_TARGET_OPTIONS: TargetOption[] = [
  { id: 'main', label: 'Main slot', hint: 'secondScreen:main' },
  { id: 'telemetry', label: 'Telemetry slot', hint: 'secondScreen:telemetry' },
  { id: 'alert', label: 'Alert slot', hint: 'secondScreen:alert' },
  { id: 'status', label: 'Status slot', hint: 'secondScreen:status' }
]

interface DashboardTokenMatch {
  start: number
  end: number
  query: string
}

interface PropertyTokenMatch {
  start: number
  end: number
  query: string
}

interface PropertyPickerOption {
  id: string
  label: string
  description: string
}

// Flat list of well-known telemetry properties for the expression picklist.
const TELEMETRY_PROPERTY_OPTIONS: PropertyPickerOption[] = [
  { id: 'speedKmh', label: 'speedKmh', description: 'Velocidade em km/h' },
  { id: 'rpm', label: 'rpm', description: 'Rotação do motor' },
  { id: 'maxRpm', label: 'maxRpm', description: 'RPM máximo do motor' },
  { id: 'gear', label: 'gear', description: 'Marcha atual (-1 ré, 0 neutro, 1..n)' },
  { id: 'throttle', label: 'throttle', description: 'Posição do acelerador (0..1)' },
  { id: 'brake', label: 'brake', description: 'Posição do freio (0..1)' },
  { id: 'clutch', label: 'clutch', description: 'Posição da embreagem (0..1)' },
  { id: 'absActive', label: 'absActive', description: 'ABS atuando (booleano)' },
  { id: 'tcActive', label: 'tcActive', description: 'TC atuando (booleano)' },
  { id: 'connected', label: 'connected', description: 'Conectado ao sim (booleano)' },
  { id: 'carName', label: 'carName', description: 'Nome do carro' },
  { id: 'trackName', label: 'trackName', description: 'Nome da pista' },
  { id: 'currentLap', label: 'currentLap', description: 'Volta atual' },
  { id: 'currentLapTimeSec', label: 'currentLapTimeSec', description: 'Tempo da volta atual (segundos)' },
  { id: 'lastLapTimeSec', label: 'lastLapTimeSec', description: 'Tempo da última volta (segundos)' },
  { id: 'bestLapTimeSec', label: 'bestLapTimeSec', description: 'Melhor volta da sessão (segundos)' },
  { id: 'deltaToBestSec', label: 'deltaToBestSec', description: 'Delta para melhor volta (+ pior, - melhor)' },
  { id: 'fuelLiters', label: 'fuelLiters', description: 'Combustível restante (litros)' },
  { id: 'fuelPerLap', label: 'fuelPerLap', description: 'Consumo por volta (litros)' },
  { id: 'position', label: 'position', description: 'Posição na corrida' },
  { id: 'totalCars', label: 'totalCars', description: 'Total de carros na sessão' },
  { id: 'shiftIndicatorPct', label: 'shiftIndicatorPct', description: 'Indicador de troca de marcha (0..1)' },
  { id: 'waterTempC', label: 'waterTempC', description: 'Temperatura da água do motor (°C)' },
  { id: 'oilTempC', label: 'oilTempC', description: 'Temperatura do óleo do motor (°C)' },
  { id: 'pitLimiter', label: 'pitLimiter', description: 'Pit limiter ativo (booleano)' },
  { id: 'onPitRoad', label: 'onPitRoad', description: 'Na pit lane (booleano)' },
  { id: 'incidentCount', label: 'incidentCount', description: 'Contagem de incidentes' },
  { id: 'trackTempC', label: 'trackTempC', description: 'Temperatura da pista (°C)' },
  { id: 'lapDistPct', label: 'lapDistPct', description: 'Distância percorrida na volta (0..1)' },
  { id: 'drs', label: 'drs', description: 'DRS aberto (booleano)' }
]

// Detects a bare identifier token at the cursor — not preceded by `.` (member
// access) or followed by `(` (function call). Returns null when the cursor is
// inside a dashboard() call (defer to dashboardPicker) or when no identifier is found.
function findPropertyToken(expr: string, caret: number): PropertyTokenMatch | null {
  const before = expr.slice(0, caret)
  // If we're inside a dashboard() context let the other picker handle it.
  if (/dashboard\s*\(\s*['"]?[^'")\n]*$/.test(before)) return null
  // Match a bare identifier ending at the caret.
  const match = /([A-Za-z_$][\w$.]*)\s*$/.exec(before)
  if (!match) return null
  // Reject if this looks like a function call (followed by `(`)
  if (expr[caret] === '(') return null
  const start = caret - match[1].length
  // Reject if preceded by `.` (member access)
  if (start > 0 && expr[start - 1] === '.') return null
  return { start, end: caret, query: match[1] }
}

// Built-in preset summaries, keyed by the STABLE preset id (not the random id
// `build()` mints each call). The main process resolves these ids lazily in
// `openWindow`, so a "switch dashboard" target pointing at a preset id always
// materializes — even on existing installs where the preset was never seeded.
const BUILTIN_PRESET_SUMMARIES: DashboardSummary[] = BUILTIN_PRESETS.map((preset) => {
  const dash = preset.build()
  return {
    id: preset.id,
    name: dash.name,
    width: dash.width,
    height: dash.height,
    elementCount: dash.elements.length,
    hasPreview: Boolean(dash.previewPng),
    description: dash.description,
    author: dash.author,
    updatedAt: dash.updatedAt
  }
})

// Merge persisted/custom dashboards (from `app:dash:list`) with the built-in
// presets so newly-shipped presets remain selectable. Dedup by dashboard name:
// a preset already materialized on disk keeps its persisted (resolvable) id,
// while presets absent from the list are offered under their stable preset id.
function mergeWithBuiltins(list: DashboardSummary[]): DashboardSummary[] {
  const knownNames = new Set(list.map((dash) => dash.name.trim().toLowerCase()))
  const extras = BUILTIN_PRESET_SUMMARIES.filter((preset) => !knownNames.has(preset.name.trim().toLowerCase()))
  return [...list, ...extras]
}

function escapeExpressionString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function findDashboardToken(expr: string, caret: number): DashboardTokenMatch | null {
  const before = expr.slice(0, caret)
  const match = /dashboard(?:\s*\(\s*['"]?([^'")]*)?)?$/i.exec(before)
  if (!match) return null
  const start = caret - match[0].length
  const previous = start > 0 ? expr[start - 1] : ''
  if (previous && /[\w$]/.test(previous)) return null
  return { start, end: caret, query: match[1] ?? '' }
}

// Slugify expression name → safe identifier for dashboardVar / overlay
// targets. Falls back to the expression id when the name slugs to empty.
function slugifyName(name: string, fallback: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

function defaultTargetFor(
  kind: OutputTargetKind,
  expr: ExpressionDef,
  options: { serialDeviceId?: string } = {}
): OutputTarget {
  const baseName = expr.outputName?.trim() || slugifyName(expr.name, expr.id)
  switch (kind) {
    case 'dashboardVar':
      return { kind: 'dashboardVar', name: baseName }
    case 'dashboard':
      return { kind: 'dashboard', dashboardId: '', dashboardName: '' }
    case 'overlay':
      return { kind: 'overlay', name: 'customValue' }
    case 'serial':
      return { kind: 'serial', deviceId: options.serialDeviceId, template: `${baseName}=\${value}\n` }
    case 'secondScreen':
      return { kind: 'secondScreen', slot: 'main' }
  }
}

function serialDeviceLabel(device: SerialDeviceSummary): string {
  const role = device.kind === 'sim-x' ? 'ButtonBox' : 'Serial'
  return `${device.label || role} (${device.id})`
}

function targetOptionsWithSavedValue(options: TargetOption[], savedId: string | undefined, savedLabel: string): TargetOption[] {
  if (!savedId || options.some((option) => option.id === savedId)) return options
  return [{ id: savedId, label: savedLabel, hint: savedId }, ...options]
}

function normalizeTargetsForSave(
  targets: OutputTarget[] | undefined,
  defaultSerialDeviceId: string | undefined
): OutputTarget[] | undefined {
  if (!targets || targets.length === 0) return undefined
  return targets.map((target) => {
    if (target.kind !== 'serial' || target.deviceId || !defaultSerialDeviceId) return target
    return { ...target, deviceId: defaultSerialDeviceId }
  })
}

// Stable id convention: `expr:<exprId>:<targetKind>`. One route per
// (expression, targetKind) pair — enough for the typical "publish this
// expression to dashboard AND overlay AND serial" workflow without forcing
// the user to manage route ids manually.
function routeIdFor(exprId: string, kind: OutputTargetKind): string {
  return `expr:${exprId}:${kind}`
}

// Mirror an ExpressionDef's targets into the canonical OutputRoute list.
// Strategy:
//   1. Drop every existing route owned by this expression (prefix match).
//   2. Re-insert one route per current target, preserving any user-set
//      `enabled`/`format` fields from the previous route with the same id.
//   3. Routes owned by OTHER expressions and manual routes are untouched.
function syncRoutesForExpression(
  currentRoutes: OutputRoute[],
  expr: ExpressionDef
): OutputRoute[] {
  const ownedPrefix = `expr:${expr.id}:`
  const previousById = new Map<string, OutputRoute>()
  for (const route of currentRoutes) {
    if (route.id.startsWith(ownedPrefix)) previousById.set(route.id, route)
  }
  const keep = currentRoutes.filter((route) => !route.id.startsWith(ownedPrefix))
  const timestamp = new Date().toISOString()
  const exprRoutes: OutputRoute[] = (expr.targets ?? []).map((target) => {
    const id = routeIdFor(expr.id, target.kind)
    const previous = previousById.get(id)
    return {
      id,
      name: expr.name,
      enabled: previous ? previous.enabled : true,
      source: { kind: 'expression', exprId: expr.id },
      target,
      format: previous?.format,
      updatedAt: timestamp
    }
  })
  return [...keep, ...exprRoutes]
}

// Remove every route owned by this expression — used on delete so we don't
// leave dangling expression-source routes pointing at a missing exprId.
function pruneRoutesForExpression(currentRoutes: OutputRoute[], exprId: string): OutputRoute[] {
  const ownedPrefix = `expr:${exprId}:`
  return currentRoutes.filter((route) => !route.id.startsWith(ownedPrefix))
}

function formatValue(value: ExpressionValue | undefined): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3)
  return String(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function ExpressionsView({ showToast }: AppViewProps): ReactElement {
  const expressionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [expressions, setExpressions] = useState<ExpressionDef[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExpressionDef>(() => blankExpression())
  const [latest, setLatest] = useState<TelemetrySnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [enabledVarIds, setEnabledVarIds] = useState<EnabledIracingVars>([])
  const [liveResults, setLiveResults] = useState<Record<string, ExpressionResultEntry>>({})
  const [serialDevices, setSerialDevices] = useState<SerialDeviceSummary[]>([])
  const [dashboards, setDashboards] = useState<DashboardSummary[]>(() => mergeWithBuiltins([]))
  const [dashboardPicker, setDashboardPicker] = useState<{ open: boolean; match: DashboardTokenMatch | null; activeIndex: number }>({
    open: false,
    match: null,
    activeIndex: 0
  })
  const [propPicker, setPropPicker] = useState<{ open: boolean; match: PropertyTokenMatch | null; activeIndex: number }>({
    open: false,
    match: null,
    activeIndex: 0
  })

  const enabledVarSet = useMemo(() => new Set(enabledVarIds), [enabledVarIds])
  const scope = useMemo(() => ({
    ...flattenExpressionScope(latest),
    ...buildIracingExpressionScope(latest, enabledVarIds)
  }), [enabledVarIds, latest])
  const liveResult = useMemo(() => {
    if (!draft.expr.trim()) return { value: null as ExpressionValue, error: 'Informe uma expressão.' }
    try {
      return { value: evaluateExpression(draft.expr, scope), error: null }
    } catch (error) {
      return { value: null as ExpressionValue, error: getErrorMessage(error) }
    }
  }, [draft.expr, scope])

  const variableRows = useMemo(() => IRACING_VARIABLES
    .filter((item) => enabledVarSet.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.telemetryField ? `${item.id} · ${item.telemetryField}` : item.id,
      value: getIracingTelemetryValue(latest, item),
      unit: item.unit
    })), [enabledVarSet, latest])

  const iracingGroups = useMemo(() => IRACING_VAR_CATEGORY_ORDER.map((category) => ({
    category,
    label: IRACING_VAR_CATEGORY_LABELS[category],
    variables: IRACING_VARIABLES.filter((item) => item.category === category)
  })).filter((group) => group.variables.length > 0), [])

  const serialTargetOptions = useMemo<TargetOption[]>(() => {
    return serialDevices
      .filter((device) => device.connected)
      .slice()
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'sim-x' ? -1 : 1
        return a.label.localeCompare(b.label)
      })
      .map((device) => ({
        id: device.id,
        label: serialDeviceLabel(device),
        hint: `${device.path} · ${device.baud}`
      }))
  }, [serialDevices])

  const dashboardTargetOptions = useMemo<TargetOption[]>(() => {
    return dashboards.map((dash) => ({
      id: dash.id,
      label: dash.name,
      hint: `${dash.width}×${dash.height} · ${dash.elementCount} elemento(s)`
    }))
  }, [dashboards])

  const dashboardPickerOptions = useMemo(() => {
    const query = dashboardPicker.match?.query.trim().toLowerCase() ?? ''
    const options = query
      ? dashboards.filter((dash) => dash.name.toLowerCase().includes(query))
      : dashboards
    return options.slice(0, 8)
  }, [dashboardPicker.match?.query, dashboards])

  const propPickerOptions = useMemo<PropertyPickerOption[]>(() => {
    const query = propPicker.match?.query.trim().toLowerCase() ?? ''
    if (!query) return TELEMETRY_PROPERTY_OPTIONS.slice(0, 10)
    return TELEMETRY_PROPERTY_OPTIONS.filter(
      (opt) => opt.id.toLowerCase().includes(query) || opt.description.toLowerCase().includes(query)
    ).slice(0, 10)
  }, [propPicker.match?.query])

  const defaultSerialDeviceId = useMemo(() => {
    return serialDevices.find((device) => device.connected && device.kind === 'sim-x')?.id ?? serialTargetOptions[0]?.id
  }, [serialDevices, serialTargetOptions])

  const persist = useCallback(async (next: ExpressionDef[]): Promise<void> => {
    const saved = await window.ipc.invoke<ExpressionDef[]>(EXPR_CHANNELS.setExpressions, next)
    setExpressions(saved)
  }, [])

  const persistEnabledVars = useCallback(async (next: EnabledIracingVars): Promise<void> => {
    const saved = await window.ipc.invoke<EnabledIracingVars>(EXPR_CHANNELS.setEnabledVars, next)
    setEnabledVarIds(saved)
  }, [])

  const reloadExpressions = useCallback(async (): Promise<void> => {
    try {
      const [items, enabledVars] = await Promise.all([
        window.ipc.invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions),
        window.ipc.invoke<EnabledIracingVars>(EXPR_CHANNELS.getEnabledVars)
      ])
      setExpressions(items)
      setEnabledVarIds(enabledVars)
    } catch (error) {
      setLoadError(getErrorMessage(error))
    }
  }, [])

  // Read current OutputRoutes, run the requested mutation on them, and write
  // the result back. We do the read+merge per save (not on every keystroke)
  // so the renderer never holds a stale view of the canonical route store.
  const mutateRoutes = useCallback(
    async (mutator: (current: OutputRoute[]) => OutputRoute[]): Promise<void> => {
      const current = await window.ipc.invoke<OutputRoute[]>(OUTPUTS_CHANNELS.getRoutes)
      const next = mutator(current ?? [])
      await window.ipc.invoke<OutputRoute[]>(OUTPUTS_CHANNELS.setRoutes, next)
    },
    []
  )

  useEffect(() => {
    void Promise.all([
      window.ipc.invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions),
      window.ipc.invoke<EnabledIracingVars>(EXPR_CHANNELS.getEnabledVars)
    ])
      .then(([items, enabledVars]) => {
        setExpressions(items)
        setEnabledVarIds(enabledVars)
        if (items[0]) {
          setSelectedId(items[0].id)
          setDraft(items[0])
        }
      })
      .catch((error) => setLoadError(getErrorMessage(error)))

    void window.ipc
      .invoke<Record<string, ExpressionResultEntry>>(EXPR_CHANNELS.getResults)
      .then((snapshot) => {
        if (snapshot) setLiveResults(snapshot)
      })
      .catch(() => undefined)

    const unsubscribeResults = window.ipc.subscribe(EXPR_CHANNELS.results, (payload) => {
      const batch = payload as ExpressionResultsBatch | undefined
      if (!batch || !batch.results) return
      setLiveResults((current) => ({ ...current, ...batch.results }))
    })

    void getLatestTelemetry().then(setLatest).catch(() => undefined)
    const unsubscribeTelemetry = onTelemetry(setLatest)
    return () => {
      unsubscribeResults()
      unsubscribeTelemetry()
    }
  }, [])

  useEffect(() => {
    void window.ipc
      .invoke<SerialDeviceSummary[]>(ARDUINO_CHANNELS.listDevices)
      .then((items) => setSerialDevices(items ?? []))
      .catch(() => undefined)

    const unsubscribeDevices = window.ipc.subscribe<ArduinoDevicesChangedPayload>(
      ARDUINO_CHANNELS.devicesChanged,
      (payload) => setSerialDevices(payload.devices ?? [])
    )
    return unsubscribeDevices
  }, [])

  useEffect(() => {
    void window.ipc
      .invoke<DashboardSummary[]>('app:dash:list')
      .then((items) => {
        if (Array.isArray(items)) setDashboards(mergeWithBuiltins(items))
      })
      .catch(() => undefined)

    const unsubscribeDashboards = window.ipc.subscribe<DashboardSummary[]>('app:dash:list', (items) => {
      if (Array.isArray(items)) setDashboards(mergeWithBuiltins(items))
    })
    return unsubscribeDashboards
  }, [])

  const selectExpression = useCallback((item: ExpressionDef): void => {
    setSelectedId(item.id)
    setDraft(item)
  }, [])

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!draft.name.trim() || !draft.expr.trim()) {
      showToast('Informe nome e expressão.', 'error')
      return
    }
    if (liveResult.error) {
      showToast(liveResult.error, 'error')
      return
    }
    const normalized: ExpressionDef = {
      ...draft,
      id: draft.id || `expr-${Date.now()}`,
      name: draft.name.trim(),
      expr: draft.expr.trim(),
      targets: normalizeTargetsForSave(draft.targets, defaultSerialDeviceId),
      outputName: draft.outputName?.trim() ? draft.outputName.trim() : undefined
    }
    const exists = expressions.some((item) => item.id === normalized.id)
    const next = exists ? expressions.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...expressions]
    try {
      await persist(next)
      // Sync OutputRoutes AFTER the expression itself was persisted. If the
      // route write fails we surface the error but keep the saved expression
      // so the user can retry without losing their work.
      try {
        await mutateRoutes((current) => syncRoutesForExpression(current, normalized))
      } catch (routeError) {
        showToast(`Expressão salva, mas falhou ao sincronizar saídas: ${getErrorMessage(routeError)}`, 'error')
      }
      setSelectedId(normalized.id)
      setDraft(normalized)
      showToast('Expressão salva.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [defaultSerialDeviceId, draft, expressions, liveResult.error, mutateRoutes, persist, showToast])

  const deleteDraft = useCallback(async (): Promise<void> => {
    if (!selectedId) return
    const next = expressions.filter((item) => item.id !== selectedId)
    try {
      await persist(next)
      try {
        await mutateRoutes((current) => pruneRoutesForExpression(current, selectedId))
      } catch (routeError) {
        showToast(`Expressão removida, mas falhou ao limpar saídas: ${getErrorMessage(routeError)}`, 'error')
      }
      setSelectedId(next[0]?.id ?? null)
      setDraft(next[0] ?? blankExpression())
      showToast('Expressão removida.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [expressions, mutateRoutes, persist, selectedId, showToast])

  const toggleIracingVar = useCallback(async (id: string): Promise<void> => {
    const next = enabledVarSet.has(id) ? enabledVarIds.filter((item) => item !== id) : [...enabledVarIds, id]
    try {
      await persistEnabledVars(next)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [enabledVarIds, enabledVarSet, persistEnabledVars, showToast])

  // ─── Targets editor (multi-select destinations per expression) ───────────

  const draftTargetsByKind = useMemo(() => {
    const map = new Map<OutputTargetKind, OutputTarget>()
    for (const target of draft.targets ?? []) map.set(target.kind, target)
    return map
  }, [draft.targets])

  const setDraftTargets = useCallback((next: OutputTarget[]): void => {
    setDraft((current) => ({ ...current, targets: next.length > 0 ? next : undefined }))
  }, [])

  const toggleTargetKind = useCallback((kind: OutputTargetKind): void => {
    setDraft((current) => {
      const list = current.targets ?? []
      const exists = list.some((target) => target.kind === kind)
      if (exists) {
        const next = list.filter((target) => target.kind !== kind)
        return { ...current, targets: next.length > 0 ? next : undefined }
      }
      if (kind === 'dashboard') {
        const dash = dashboards[0]
        if (!dash) return current
        return {
          ...current,
          targets: [...list, { kind: 'dashboard', dashboardId: dash.id, dashboardName: dash.name }]
        }
      }
      const added = defaultTargetFor(kind, current, { serialDeviceId: defaultSerialDeviceId })
      return { ...current, targets: [...list, added] }
    })
  }, [dashboards, defaultSerialDeviceId])

  const updateTarget = useCallback((kind: OutputTargetKind, patch: Partial<OutputTarget>): void => {
    setDraft((current) => {
      const list = current.targets ?? []
      const next = list.map((target) => {
        if (target.kind !== kind) return target
        // Merge as the same target kind — TypeScript can't follow the runtime
        // narrowing on `kind`, so we cast through `OutputTarget` once.
        return { ...target, ...patch, kind } as OutputTarget
      })
      return { ...current, targets: next }
    })
  }, [])

  const refreshDashboardPicker = useCallback((expr: string, caret: number): void => {
    const match = findDashboardToken(expr, caret)
    const query = match?.query.trim().toLowerCase() ?? ''
    const count = match
      ? (query ? dashboards.filter((dash) => dash.name.toLowerCase().includes(query)).length : dashboards.length)
      : 0
    setDashboardPicker((current) => ({
      open: Boolean(match),
      match,
      activeIndex: match ? Math.min(current.activeIndex, Math.max(0, Math.min(count, 8) - 1)) : 0
    }))
    // Property picker is mutually exclusive — close it when dashboard picker opens.
    if (match) {
      setPropPicker({ open: false, match: null, activeIndex: 0 })
      return
    }
    const propMatch = findPropertyToken(expr, caret)
    setPropPicker((current) => ({
      open: Boolean(propMatch),
      match: propMatch,
      activeIndex: propMatch ? Math.min(current.activeIndex, 9) : 0
    }))
  }, [dashboards])

  const focusExpressionAt = useCallback((position: number): void => {
    window.requestAnimationFrame(() => {
      const input = expressionInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(position, position)
    })
  }, [])

  const insertPropertyReference = useCallback((prop: PropertyPickerOption): void => {
    const input = expressionInputRef.current
    const caret = input?.selectionStart ?? draft.expr.length
    const match = findPropertyToken(draft.expr, caret) ?? { start: caret, end: caret, query: '' }
    const nextExpr = `${draft.expr.slice(0, match.start)}${prop.id}${draft.expr.slice(match.end)}`
    const nextCaret = match.start + prop.id.length
    setDraft((current) => ({ ...current, expr: nextExpr }))
    setPropPicker({ open: false, match: null, activeIndex: 0 })
    focusExpressionAt(nextCaret)
  }, [draft.expr, focusExpressionAt])

  const useDashboardAsTarget = useCallback((dash: DashboardSummary): void => {
    setDraft((current) => {
      const list = current.targets ?? []
      const nextTarget: OutputTarget = { kind: 'dashboard', dashboardId: dash.id, dashboardName: dash.name }
      const exists = list.some((target) => target.kind === 'dashboard')
      const next = exists
        ? list.map((target) => (target.kind === 'dashboard' ? nextTarget : target))
        : [...list, nextTarget]
      return { ...current, targets: next }
    })
  }, [])

  const insertDashboardReference = useCallback((dash: DashboardSummary): void => {
    const input = expressionInputRef.current
    const caret = input?.selectionStart ?? draft.expr.length
    const match = findDashboardToken(draft.expr, caret) ?? { start: caret, end: caret, query: '' }
    const reference = `dashboard('${escapeExpressionString(dash.name)}')`
    const nextExpr = `${draft.expr.slice(0, match.start)}${reference}${draft.expr.slice(match.end)}`
    const nextCaret = match.start + reference.length
    setDraft((current) => {
      const list = current.targets ?? []
      const nextTarget: OutputTarget = { kind: 'dashboard', dashboardId: dash.id, dashboardName: dash.name }
      const nextTargets = list.some((target) => target.kind === 'dashboard')
        ? list.map((target) => (target.kind === 'dashboard' ? nextTarget : target))
        : [...list, nextTarget]
      return { ...current, expr: nextExpr, targets: nextTargets }
    })
    setDashboardPicker({ open: false, match: null, activeIndex: 0 })
    focusExpressionAt(nextCaret)
  }, [draft.expr, focusExpressionAt])

  const draftLiveValue = useMemo<ExpressionResultEntry | undefined>(() => {
    if (!draft.id) return undefined
    return liveResults[draft.id]
  }, [draft.id, liveResults])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 0.8fr) minmax(420px, 1.4fr)', gap: 16 }}>
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={label}>Biblioteca</div>
            <h3 style={{ margin: '4px 0 0' }}>Expressões</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="expressions" label="Expressões" onImported={() => void reloadExpressions()} />
            <button className="primary-action compact" type="button" onClick={() => { setSelectedId(null); setDraft(blankExpression()) }}>
              Nova
            </button>
          </div>
        </div>
        {loadError && <p style={{ color: 'var(--accent-danger)' }}>{loadError}</p>}
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {expressions.length === 0 && <p style={{ opacity: 0.7 }}>Nenhuma expressão salva ainda.</p>}
          {expressions.map((item) => (
            <button
              key={item.id}
              onClick={() => selectExpression(item)}
              style={{
                textAlign: 'left',
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                border: item.id === selectedId ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.12)',
                background: item.id === selectedId ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(0,0,0,0.18)',
                color: '#fff'
              }}
              type="button"
            >
              <strong>{item.name}</strong>
              <code style={{ display: 'block', opacity: 0.72, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.expr}
              </code>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginTop: 6,
                  opacity: 0.7,
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                <span>{item.targets?.length ? `→ ${item.targets.length} destino(s)` : 'sem destinos'}</span>
                <span>{formatValue(liveResults[item.id]?.value)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={card}>
          <div style={label}>Editor</div>
          <label style={{ display: 'block', marginTop: 10 }}>
            Nome
            <input style={input} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Expressão
            <div style={{ position: 'relative' }}>
              <textarea
                ref={expressionInputRef}
                rows={4}
                style={{ ...input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
                value={draft.expr}
                aria-autocomplete="list"
                aria-expanded={dashboardPicker.open}
                aria-controls="dashboard-expression-picklist"
                aria-activedescendant={dashboardPicker.open ? `dashboard-expression-option-${dashboardPicker.activeIndex}` : undefined}
                onChange={(event) => {
                  const next = event.target.value
                  setDraft((current) => ({ ...current, expr: next }))
                  refreshDashboardPicker(next, event.target.selectionStart)
                }}
                onClick={(event) => refreshDashboardPicker(draft.expr, event.currentTarget.selectionStart)}
                onKeyUp={(event) => {
                  if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
                  refreshDashboardPicker(draft.expr, event.currentTarget.selectionStart)
                }}
                onKeyDown={(event) => {
                  if (dashboardPicker.open) {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setDashboardPicker({ open: false, match: null, activeIndex: 0 })
                      return
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      setDashboardPicker((current) => {
                        const count = Math.max(1, dashboardPickerOptions.length)
                        const delta = event.key === 'ArrowDown' ? 1 : -1
                        return { ...current, activeIndex: (current.activeIndex + delta + count) % count }
                      })
                      return
                    }
                    if (event.key === 'Enter' && dashboardPickerOptions[dashboardPicker.activeIndex]) {
                      event.preventDefault()
                      insertDashboardReference(dashboardPickerOptions[dashboardPicker.activeIndex])
                    }
                    return
                  }
                  if (propPicker.open) {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setPropPicker({ open: false, match: null, activeIndex: 0 })
                      return
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      setPropPicker((current) => {
                        const count = Math.max(1, propPickerOptions.length)
                        const delta = event.key === 'ArrowDown' ? 1 : -1
                        return { ...current, activeIndex: (current.activeIndex + delta + count) % count }
                      })
                      return
                    }
                    if (event.key === 'Enter' && propPickerOptions[propPicker.activeIndex]) {
                      event.preventDefault()
                      insertPropertyReference(propPickerOptions[propPicker.activeIndex])
                    }
                  }
                }}
              />
              {dashboardPicker.open && (
                <div
                  id="dashboard-expression-picklist"
                  role="listbox"
                  aria-label="Dashboards disponíveis"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 'calc(100% + 6px)',
                    zIndex: 20,
                    border: '1px solid rgba(var(--accent-rgb),0.45)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(8,12,18,0.98)',
                    boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
                    padding: 8,
                    display: 'grid',
                    gap: 6
                  }}
                >
                  {dashboardPickerOptions.length === 0 && (
                    <div style={{ padding: 10, opacity: 0.7 }}>Nenhum dashboard encontrado.</div>
                  )}
                  {dashboardPickerOptions.map((dash, index) => (
                    <button
                      id={`dashboard-expression-option-${index}`}
                      key={dash.id}
                      role="option"
                      aria-selected={index === dashboardPicker.activeIndex}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertDashboardReference(dash)}
                      style={{
                        textAlign: 'left',
                        border: index === dashboardPicker.activeIndex ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.08)',
                        background: index === dashboardPicker.activeIndex ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.04)',
                        color: '#fff',
                        borderRadius: 'var(--radius-sm)',
                        padding: '9px 10px',
                        cursor: 'pointer'
                      }}
                    >
                      <strong>{dash.name}</strong>
                      <span style={{ display: 'block', opacity: 0.65, fontSize: 12, marginTop: 3 }}>
                        {dash.width}×{dash.height} · {dash.elementCount} elemento(s)
                      </span>
                    </button>
                  ))}
                  {dashboardPickerOptions[dashboardPicker.activeIndex] && (
                    <button
                      type="button"
                      className="ghost-action compact"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        useDashboardAsTarget(dashboardPickerOptions[dashboardPicker.activeIndex])
                        setDashboardPicker({ open: false, match: null, activeIndex: 0 })
                      }}
                    >
                      Usar como ação de troca de dashboard
                    </button>
                  )}
                </div>
              )}
              {propPicker.open && (
                <div
                  id="property-expression-picklist"
                  role="listbox"
                  aria-label="Propriedades de telemetria"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 30,
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
                    padding: 6,
                    display: 'grid',
                    gap: 4,
                    maxHeight: 260,
                    overflowY: 'auto'
                  }}
                >
                  {propPickerOptions.length === 0 && (
                    <div style={{ padding: 10, opacity: 0.7 }}>Nenhuma propriedade encontrada.</div>
                  )}
                  {propPickerOptions.map((prop, index) => (
                    <button
                      id={`property-expression-option-${index}`}
                      key={prop.id}
                      role="option"
                      aria-selected={index === propPicker.activeIndex}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertPropertyReference(prop)}
                      style={{
                        textAlign: 'left',
                        border: index === propPicker.activeIndex ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.08)',
                        background: index === propPicker.activeIndex ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.04)',
                        color: '#fff',
                        borderRadius: 'var(--radius-sm)',
                        padding: '7px 10px',
                        cursor: 'pointer'
                      }}
                    >
                      <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{prop.label}</strong>
                      <span style={{ display: 'block', opacity: 0.65, fontSize: 12, marginTop: 2 }}>{prop.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </label>
          <p style={{ opacity: 0.72, margin: '10px 0 0' }}>
            Suporte: operadores + - * / % && || ! ?:, funções min/max/abs/round/floor/ceil/clamp, if/iif, format/formattime, str/len, contains/startswith/endswith, coalesce, switch, between, pow/sqrt/sign/log, not, dashboard. Digite um identificador para autocomplete de propriedades de telemetria (↑↓ Enter Esc).
          </p>
          <label style={{ display: 'block', marginTop: 12 }}>
            Nome de publicação (opcional)
            <input
              style={input}
              placeholder={slugifyName(draft.name, draft.id || 'expr')}
              value={draft.outputName ?? ''}
              onChange={(event) =>
                setDraft((current) => ({ ...current, outputName: event.target.value }))
              }
            />
            <span style={{ display: 'block', opacity: 0.6, marginTop: 4, fontSize: 12 }}>
              Usado como variável de dashboard/overlay e slot quando o target é criado. Padrão: slug do nome.
            </span>
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="primary-action compact" type="button" onClick={() => void saveDraft()}>Salvar</button>
            <button className="ghost-action danger compact" type="button" onClick={() => void deleteDraft()} disabled={!selectedId}>Excluir</button>
          </div>
        </section>

        <section style={card}>
          <div style={label}>Destinos (output targets)</div>
          <h3 style={{ margin: '5px 0 8px' }}>Onde publicar esta expressão</h3>
          <p style={{ margin: 0, opacity: 0.72 }}>
            Marque um ou mais destinos. Ao salvar, criamos um OutputRoute por destino (id <code>expr:&lt;exprId&gt;:&lt;kind&gt;</code>) lendo a fonte
            <code> {`{kind:'expression', exprId:'${draft.id || '…'}'}`}</code>.
          </p>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {TARGET_KIND_ORDER.map((kind) => {
              const checked = draftTargetsByKind.has(kind)
              const target = draftTargetsByKind.get(kind)
              return (
                <div
                  key={kind}
                  style={{
                    border: checked ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid rgba(255,255,255,0.1)',
                    background: checked ? 'rgba(var(--accent-rgb),0.10)' : 'rgba(0,0,0,0.16)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 12,
                    display: 'grid',
                    gap: 10
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleTargetKind(kind)} />
                    <strong>{TARGET_KIND_LABELS[kind]}</strong>
                    <code style={{ opacity: 0.62, marginLeft: 'auto', fontSize: 12 }}>
                      {routeIdFor(draft.id || 'expr', kind)}
                    </code>
                  </label>
                  {checked && target && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {target.kind === 'dashboardVar' && (
                        <label style={{ display: 'block' }}>
                          Nome da variável
                          <input
                            style={input}
                            value={target.name}
                            onChange={(event) =>
                              updateTarget(target.kind, { name: event.target.value } as Partial<OutputTarget>)
                            }
                          />
                        </label>
                      )}
                      {target.kind === 'dashboard' && (() => {
                        const options = targetOptionsWithSavedValue(
                          dashboardTargetOptions,
                          target.dashboardId,
                          target.dashboardName || 'Dashboard salvo'
                        )
                        return (
                          <label style={{ display: 'block' }}>
                            Dashboard para ativar quando a expressão for verdadeira
                            <select
                              style={input}
                              value={target.dashboardId}
                              disabled={options.length === 0}
                              onChange={(event) => {
                                const dash = dashboards.find((item) => item.id === event.target.value)
                                updateTarget('dashboard', {
                                  dashboardId: event.target.value,
                                  dashboardName: dash?.name ?? event.target.value
                                } as Partial<OutputTarget>)
                              }}
                            >
                              {options.length === 0 && <option value="">Nenhum dashboard disponível</option>}
                              {options.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}{option.hint ? ` · ${option.hint}` : ''}
                                </option>
                              ))}
                            </select>
                            <span style={{ display: 'block', opacity: 0.65, marginTop: 4, fontSize: 12 }}>
                              Reutiliza <code>app:dash:activate</code>: abre este dashboard e fecha o dashboard anterior quando o valor sair de falso para verdadeiro.
                            </span>
                          </label>
                        )
                      })()}
                      {target.kind === 'overlay' && (() => {
                        const options = targetOptionsWithSavedValue(
                          OVERLAY_TARGET_OPTIONS,
                          target.name,
                          'Destino salvo'
                        )
                        return (
                          <label style={{ display: 'block' }}>
                            Widget de overlay
                            <select
                              style={input}
                              value={target.name}
                              onChange={(event) =>
                                updateTarget('overlay', { name: event.target.value } as Partial<OutputTarget>)
                              }
                            >
                              {options.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}{option.hint ? ` · ${option.hint}` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                        )
                      })()}
                      {target.kind === 'serial' && (
                        <>
                          {(() => {
                            const options = targetOptionsWithSavedValue(
                              serialTargetOptions,
                              target.deviceId,
                              'Device salvo'
                            )
                            const value = target.deviceId ?? defaultSerialDeviceId ?? ''
                            return (
                              <label style={{ display: 'block' }}>
                                Dispositivo serial
                                <select
                                  style={input}
                                  value={value}
                                  disabled={options.length === 0}
                                  onChange={(event) =>
                                    updateTarget('serial', {
                                      deviceId: event.target.value || undefined
                                    } as Partial<OutputTarget>)
                                  }
                                >
                                  {options.length === 0 && (
                                    <option value="">Nenhum dispositivo serial conectado</option>
                                  )}
                                  {options.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}{option.hint ? ` · ${option.hint}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )
                          })()}
                          <label style={{ display: 'block' }}>
                            Template serial (use <code>{'${value}'}</code> / <code>{'${field}'}</code>)
                            <input
                              style={input}
                              value={target.template}
                              onChange={(event) =>
                                updateTarget('serial', { template: event.target.value } as Partial<OutputTarget>)
                              }
                            />
                          </label>
                        </>
                      )}
                      {target.kind === 'secondScreen' && (
                        (() => {
                          const options = targetOptionsWithSavedValue(
                            SECOND_SCREEN_TARGET_OPTIONS,
                            target.slot,
                            'Slot salvo'
                          )
                          return (
                            <label style={{ display: 'block' }}>
                              Slot da segunda tela
                              <select
                                style={input}
                                value={target.slot}
                                onChange={(event) =>
                                  updateTarget('secondScreen', { slot: event.target.value } as Partial<OutputTarget>)
                                }
                              >
                                {options.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}{option.hint ? ` · ${option.hint}` : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )
                        })()
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section style={{ ...card, borderColor: liveResult.error ? 'rgba(255,107,107,0.55)' : 'rgba(var(--accent-rgb),0.45)' }}>
          <div style={label}>Teste ao vivo</div>
          <h3 style={{ margin: '5px 0 10px', color: liveResult.error ? 'var(--accent-danger)' : 'var(--accent-primary)' }}>
            {liveResult.error ? 'Erro na expressão' : formatValue(liveResult.value)}
          </h3>
          <p style={{ margin: 0, opacity: 0.75 }}>
            {liveResult.error ?? `${latest?.connected ? 'Telemetria conectada' : 'Aguardando/mock'} · ${latest?.sim ?? 'none'}`}
          </p>
          {draftLiveValue && (
            <p style={{ margin: '8px 0 0', opacity: 0.78, fontSize: 12 }}>
              Última transmissão (<code>expr:results</code>): <strong>{formatValue(draftLiveValue.value)}</strong> ·{' '}
              <code>{draftLiveValue.name}</code>
            </p>
          )}
        </section>

        <section style={card}>
          <div style={label}>Variáveis do iRacing</div>
          <h3 style={{ margin: '5px 0 8px' }}>Catálogo de campos</h3>
          <p style={{ margin: 0, opacity: 0.72 }}>
            Clique para habilitar/desabilitar. Campos habilitados com mapeamento aparecem no escopo da expressão pelo nome do SDK (ex.: <code>Speed</code>).
          </p>
          <div style={{ display: 'grid', gap: 12, marginTop: 14, maxHeight: 420, overflow: 'auto', paddingRight: 4 }}>
            {iracingGroups.map((group) => {
              const enabledCount = group.variables.filter((item) => enabledVarSet.has(item.id)).length
              return (
                <div key={group.category} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)', padding: 10, background: 'rgba(0,0,0,0.14)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <strong>{group.label}</strong>
                    <span style={{ opacity: 0.65, fontSize: 12 }}>{enabledCount}/{group.variables.length}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8, marginTop: 10 }}>
                    {group.variables.map((item) => {
                      const value = getIracingTelemetryValue(latest, item)
                      return (
                        <label
                          key={item.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr',
                            gap: 8,
                            alignItems: 'start',
                            padding: 9,
                            borderRadius: 'var(--radius-sm)',
                            border: enabledVarSet.has(item.id) ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid rgba(255,255,255,0.08)',
                            background: enabledVarSet.has(item.id) ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(0,0,0,0.12)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={enabledVarSet.has(item.id)}
                            onChange={() => void toggleIracingVar(item.id)}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            <code>{item.id}</code>
                            <span style={{ display: 'block', opacity: 0.82, marginTop: 3 }}>{item.label}{item.unit ? ` · ${item.unit}` : ''}</span>
                            <span style={{ display: 'block', opacity: 0.62, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                              {item.telemetryField ? `${item.telemetryField}: ${formatValue(value)}${item.unit && value !== undefined ? ` ${item.unit}` : ''}` : 'Sem mapeamento no TelemetrySnapshot'}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section style={card}>
          <div style={label}>Campos habilitados</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 12, maxHeight: 260, overflow: 'auto' }}>
            {variableRows.length === 0 && <p style={{ opacity: 0.7 }}>Nenhuma variável do iRacing habilitada.</p>}
            {variableRows.map((item) => (
              <div key={item.id} style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 'var(--radius-sm)', padding: 9, background: 'rgba(0,0,0,0.16)' }}>
                <code>{item.name}</code>
                <div style={{ opacity: 0.68, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(item.value)}{item.unit && item.value !== undefined ? ` ${item.unit}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
