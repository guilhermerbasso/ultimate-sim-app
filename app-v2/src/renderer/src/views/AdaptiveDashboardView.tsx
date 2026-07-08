import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import type { CoachSeverity } from '../../../shared/coach'
import type {
  AdaptiveBlink,
  AdaptiveElementRule,
  AdaptiveMomentFrame,
  AdaptiveMomentRule,
  Dashboard,
  DashboardAdaptiveConfig,
  DashboardElement,
  DashboardSummary
} from '../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  ADAPTIVE_DASHBOARD_ID,
  ADAPTIVE_DASHBOARD_PRESET,
  isAdaptiveDashboard
} from '../../../shared/dashboard-adaptive-preset'
import {
  MOMENT_CATALOG,
  MOMENT_GROUP_LABELS,
  initialRaceMomentState,
  momentCatalogEntry,
  momentLabel,
  resolveRaceMoment,
  type RaceMomentState,
  type MomentGroup
} from '../../../shared/race-moment'
import { DashboardCanvasEditor, DashboardCanvasSurface, type EditableBoard } from './dashboard/DashboardCanvasEditor'
import { HIFI_WIDGETS_BY_ID } from '../hifi/widgets/registry'
import type { HifiAiContext, HifiAiSeverity } from '../hifi/widgets/types'
import { selectAdaptiveWidgets } from '../lib/adaptive-widget-ai'
import { useCoachReport } from '../lib/coach-heatmap'
import { coachFindings, topCoachTips } from '../lib/coach-insights'
import { useEngineerFeed } from '../lib/engineer-feed'
import { useTelemetrySelector } from '../lib/telemetry'

const CHROME = 'var(--accent-primary)'
const AMBER = 'var(--accent-warning)'
const GOOD = 'var(--accent-success)'
const DANGER = 'var(--accent-danger)'

// Warm-accent swatches (green reserved for positive states only).
const BLINK_SWATCHES: Array<{ color: string; label: string }> = [
  { color: '#FF7A00', label: 'Orange' },
  { color: '#FFB800', label: 'Amber' },
  { color: '#FF2200', label: 'Red' },
  { color: '#F4F4F4', label: 'White' },
  { color: '#1AFF6E', label: 'Green (good)' }
]

const DEFAULT_BLINK_HZ = 1.5
const MOMENT_RECOMPUTE_MS = 140
const AI_LIVE_SLOT_COUNT = 6

// A moment whose catalog entry is `detectable:false` can be authored but will not
// fire at runtime yet â€” surface that clearly so the user isn't surprised.
function momentIsDetectable(id: string): boolean {
  return momentCatalogEntry(id)?.detectable !== false
}

function NotDetectableBadge(): ReactElement {
  return (
    <span
      title="Detection for this moment is not available yet â€” the rule is saved, but it will not fire for now."
      style={{
        flex: '0 0 auto',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: '3px 6px',
        borderRadius: 999,
        color: AMBER,
        border: `1px solid ${AMBER}`,
        background: 'color-mix(in srgb, var(--accent-warning) 12%, transparent)',
        whiteSpace: 'nowrap'
      }}
    >
      coming soon
    </span>
  )
}

function FrameBadge(): ReactElement {
  return (
    <span
      title="This moment has a custom full-layout frame."
      style={{
        flex: '0 0 auto',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: '3px 6px',
        borderRadius: 999,
        color: CHROME,
        border: `1px solid ${CHROME}`,
        background: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
        whiteSpace: 'nowrap'
      }}
    >
      frame
    </span>
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function elementLabel(el: DashboardElement): string {
  return el.name?.trim() || el.style.label?.trim() || el.style.title?.trim() || el.id
}

const GROUP_ORDER: MomentGroup[] = ['session', 'lap', 'situational', 'micro']

function severityToHifi(severity: CoachSeverity): HifiAiSeverity {
  if (severity === 'high') return 'high'
  if (severity === 'med') return 'med'
  return 'low'
}

function proactiveLevel(severity: CoachSeverity | undefined): 'info' | 'warn' | 'crit' {
  if (severity === 'high') return 'crit'
  if (severity === 'med') return 'warn'
  return 'info'
}

function buildAiContext(report: ReturnType<typeof useCoachReport>, engineerFeed: ReturnType<typeof useEngineerFeed>): HifiAiContext {
  const topTip = topCoachTips(report, 1)[0]
  const findings = coachFindings(report, 8)
  const latestEngineer = engineerFeed[0]
  const latestProactive = engineerFeed.find((item) => item.source === 'proactive')
  const confidence = report && report.sampleCount > 0 ? Math.min(1, Math.max(0.35, report.sampleCount / 120)) : null

  return {
    coachTip: topTip
      ? {
          text: topTip.detail || topTip.title || report?.summary || '',
          corner: topTip.corner ? `T${topTip.corner}` : undefined,
          confidence: confidence ?? undefined
        }
      : null,
    coachFindings: findings.length > 0
      ? findings.map((finding) => ({
          label: finding.title || finding.detail || finding.kind,
          severity: severityToHifi(finding.severity)
        }))
      : null,
    engineerRadio: latestEngineer ? { text: latestEngineer.text, at: latestEngineer.at } : null,
    proactiveAlert: latestProactive ? { text: latestProactive.text, level: proactiveLevel(latestProactive.severity) } : null,
    strategy: null,
    confidence
  }
}

export default function AdaptiveDashboardView({ showToast }: AppViewProps): ReactElement {
  const [summaries, setSummaries] = useState<DashboardSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [config, setConfig] = useState<DashboardAdaptiveConfig>({ enabled: false, rules: [] })
  const [aiLiveSelection, setAiLiveSelection] = useState(true)
  const [activeMoment, setActiveMoment] = useState<string | null>(null)
  const [editingFrameMoment, setEditingFrameMoment] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const snapshot = useTelemetrySelector((snap) => snap)
  const coachReport = useCoachReport()
  const engineerFeed = useEngineerFeed(6)
  const ai = useMemo(() => buildAiContext(coachReport, engineerFeed), [coachReport, engineerFeed])
  const momentRef = useRef<RaceMomentState | null>(null)
  const latestSnapshotRef = useRef<TelemetrySnapshot | null>(null)
  const [liveMoment, setLiveMoment] = useState<RaceMomentState | null>(null)

  // â”€â”€ Load + subscribe to the dashboards list â”€â”€
  useEffect(() => {
    let cancelled = false
    void window.ipc
      .invoke<DashboardSummary[]>('app:dash:list')
      .then((items) => {
        if (cancelled) return
        setSummaries(items)
        setSelectedId((cur) => {
          if (cur && items.some((i) => i.id === cur)) return cur
          const adaptiveOne = items.find((i) => isAdaptiveDashboard(i))
          return adaptiveOne?.id ?? items[0]?.id ?? null
        })
      })
      .catch(() => undefined)
    const off = window.ipc.subscribe<DashboardSummary[]>('app:dash:list', (items) => setSummaries(items))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // â”€â”€ Load the full dashboard when the selection changes â”€â”€
  useEffect(() => {
    if (!selectedId) {
      setDash(null)
      setConfig({ enabled: false, rules: [] })
      return
    }
    let cancelled = false
    void window.ipc
      .invoke<Dashboard | null>('app:dash:get', selectedId)
      .then((full) => {
        if (cancelled || !full) return
        setDash(full)
        setConfig({ enabled: full.adaptive?.enabled ?? false, rules: full.adaptive?.rules ?? [] })
        setActiveMoment(full.adaptive?.rules?.[0]?.moment ?? null)
        setDirty(false)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const rules = config.rules ?? []
  const usedMoments = useMemo(() => new Set(rules.map((r) => r.moment)), [rules])
  const selectedRule = rules.find((r) => r.moment === activeMoment) ?? null
  const elements = dash?.elements ?? []
  const adaptiveEnabled = config.enabled ?? false
  const aiLiveActive = adaptiveEnabled && aiLiveSelection && Boolean(dash)

  useEffect(() => {
    latestSnapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    if (!aiLiveActive) {
      momentRef.current = null
      setLiveMoment(null)
      return
    }
    momentRef.current = initialRaceMomentState()
    const id = window.setInterval(() => {
      const next = resolveRaceMoment(latestSnapshotRef.current, null, momentRef.current)
      momentRef.current = next
      setLiveMoment((cur) => (cur && cur.moment === next.moment && cur.color === next.color ? cur : next))
    }, MOMENT_RECOMPUTE_MS)
    return () => window.clearInterval(id)
  }, [aiLiveActive])

  const liveWidgetIds = useMemo(
    () => selectAdaptiveWidgets({ snapshot, ai, moment: liveMoment, maxSlots: AI_LIVE_SLOT_COUNT }),
    [snapshot, ai, liveMoment]
  )

  const patchConfig = useCallback((next: DashboardAdaptiveConfig) => {
    setConfig(next)
    setDirty(true)
  }, [])

  const patchRules = useCallback(
    (nextRules: AdaptiveMomentRule[]) => patchConfig({ ...config, rules: nextRules }),
    [config, patchConfig]
  )

  const addRule = useCallback(
    (momentId: string) => {
      if (usedMoments.has(momentId)) {
        setActiveMoment(momentId)
        return
      }
      patchRules([...rules, { moment: momentId, enabled: true, elements: {} }])
      setActiveMoment(momentId)
    },
    [rules, usedMoments, patchRules]
  )

  const removeRule = useCallback(
    (momentId: string) => {
      patchRules(rules.filter((r) => r.moment !== momentId))
      setActiveMoment((cur) => (cur === momentId ? null : cur))
    },
    [rules, patchRules]
  )

  const updateRule = useCallback(
    (momentId: string, patch: Partial<AdaptiveMomentRule>) => {
      patchRules(rules.map((r) => (r.moment === momentId ? { ...r, ...patch } : r)))
    },
    [rules, patchRules]
  )

  const setElementRule = useCallback(
    (momentId: string, elementId: string, patch: AdaptiveElementRule | null) => {
      patchRules(
        rules.map((r) => {
          if (r.moment !== momentId) return r
          const nextElements: Record<string, AdaptiveElementRule> = { ...(r.elements ?? {}) }
          if (patch === null || (patch.visible === undefined && patch.emphasis === undefined && patch.blink === undefined)) {
            delete nextElements[elementId]
          } else {
            nextElements[elementId] = patch
          }
          return { ...r, elements: nextElements }
        })
      )
    },
    [rules, patchRules]
  )

  // Set (or clear when null) the full per-moment FRAME on a rule.
  const setFrame = useCallback(
    (momentId: string, frame: AdaptiveMomentFrame | null) => {
      patchRules(
        rules.map((r) => {
          if (r.moment !== momentId) return r
          if (frame === null) {
            const { frame: _drop, ...rest } = r
            return rest
          }
          return { ...r, frame }
        })
      )
    },
    [rules, patchRules]
  )

  // â”€â”€ Create / open / save â”€â”€
  const createPreset = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const summary = await window.ipc.invoke<DashboardSummary>('app:dash:createPreset', ADAPTIVE_DASHBOARD_ID)
      setSelectedId(summary.id)
      showToast('Adaptive dashboard created.', 'success')
    } catch (error) {
      showToast(`Failed to create preset: ${getErrorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, showToast])

  const openDash = useCallback(async () => {
    if (busy || !selectedId) return
    setBusy(true)
    try {
      await window.ipc.invoke('app:dash:open', selectedId, { fullscreen: false })
      showToast('Dashboard opened.', 'success')
    } catch (error) {
      showToast(`Failed to open: ${getErrorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, selectedId, showToast])

  const save = useCallback(async () => {
    if (busy || !dash) return
    setBusy(true)
    try {
      const next: Dashboard = { ...dash, adaptive: { enabled: config.enabled ?? false, rules: config.rules ?? [] } }
      await window.ipc.invoke<DashboardSummary>('app:dash:save', next)
      setDash(next)
      setDirty(false)
      showToast('Adaptive rules saved.', 'success')
    } catch (error) {
      showToast(`Failed to save: ${getErrorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [busy, dash, config, showToast])

  const selectedSummary = summaries.find((s) => s.id === selectedId) ?? null
  const isAdaptiveTarget = selectedSummary ? isAdaptiveDashboard(selectedSummary) : false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...eyebrow, color: CHROME }}>Adaptativo Â· editor</span>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-primary)' }}>Adaptive Dashboard</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 820 }}>
          Edit which widgets <strong>appear</strong> or{' '}
          <strong>hide</strong>, the highlight, and <strong>blink</strong> â€” without changing positions.
        </p>
        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: 12, maxWidth: 820 }}>
          Example: <em>when crossing the finish line</em>, show Coach improvement points plus the sector map and
          hide the radar; <em>under pressure</em>, blink the whole panel red.
        </p>
      </header>

      {/* Dashboard picker + actions */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700 }}>Dashboard</label>
          <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)} style={select}>
            {summaries.length === 0 && <option value="">(no saved dashboard)</option>}
            {summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {isAdaptiveDashboard(s) ? 'â˜… ' : ''}
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => void createPreset()} style={secondaryBtn}>
            Create adaptive preset
          </button>
          <button type="button" disabled={busy || !selectedId} onClick={() => void openDash()} style={secondaryBtn}>
            Open
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" disabled={busy || !dash || !dirty} onClick={() => void save()} style={primaryBtn}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>

        {dash && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={adaptiveEnabled}
                onChange={(e) => patchConfig({ ...config, enabled: e.target.checked })}
              />
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Adaptive mode on</span>
            </label>
            <label
              title="Local heuristic widget selection. No network, no GPU, no paid API."
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: adaptiveEnabled ? 'pointer' : 'not-allowed',
                opacity: adaptiveEnabled ? 1 : 0.55
              }}
            >
              <input
                type="checkbox"
                disabled={!adaptiveEnabled}
                checked={aiLiveActive}
                onChange={(e) => setAiLiveSelection(e.target.checked)}
              />
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>AI live selection</span>
            </label>
            {aiLiveActive && (
              <span style={{ color: GOOD, fontSize: 12, fontWeight: 700 }}>
                {liveWidgetIds.length} live widget(s) Â· {liveMoment ? momentLabel(liveMoment.moment) : 'Detecting'}
              </span>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {dash.elements.length} widgets Â· {rules.length} rule(s)
            </span>
            {!isAdaptiveTarget && !(config.enabled ?? false) && (
              <span style={{ color: AMBER, fontSize: 12 }}>
                Este dashboard sÃ³ fica adaptativo com o modo ligado acima.
              </span>
            )}
          </div>
        )}
      </section>

      {dash && aiLiveActive && (
        <HifiLiveSelectionPreview snapshot={snapshot} ai={ai} widgetIds={liveWidgetIds} moment={liveMoment} />
      )}

      {!dash && (
        <section style={card}>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            No dashboard loaded. Click <strong>Create adaptive preset</strong> to start with the
            default <em>{ADAPTIVE_DASHBOARD_PRESET.name}</em> panel, or select an existing dashboard.
          </p>
        </section>
      )}

      {dash && (
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 'var(--space-4)' }}>
          {/* Left: moment list */}
          <div style={card}>
            <h2 style={subTitle}>Moments</h2>
            <MomentPicker used={usedMoments} onAdd={addRule} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              {rules.length === 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  Add a moment above to create the first rule.
                </span>
              )}
              {rules.map((rule) => (
                <RuleRow
                  key={rule.moment}
                  rule={rule}
                  active={rule.moment === activeMoment}
                  onSelect={() => setActiveMoment(rule.moment)}
                  onToggle={(enabled) => updateRule(rule.moment, { enabled })}
                  onRemove={() => removeRule(rule.moment)}
                />
              ))}
            </div>
          </div>

          {/* Right: per-moment element rules */}
          <div style={card}>
            {!selectedRule ? (
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                Selecione um momento Ã  esquerda para configurar os widgets.
              </p>
            ) : (
              <RuleEditor
                rule={selectedRule}
                elements={elements}
                onDashboardBlink={(blink) => updateRule(selectedRule.moment, { blinkDashboard: blink ?? undefined })}
                onElementRule={(elementId, patch) => setElementRule(selectedRule.moment, elementId, patch)}
                onEditFrame={() => setEditingFrameMoment(selectedRule.moment)}
                onResetFrame={() => setFrame(selectedRule.moment, null)}
              />
            )}
          </div>
        </section>
      )}

      {dash && editingFrameMoment && (
        <FrameEditorModal
          dash={dash}
          rule={rules.find((r) => r.moment === editingFrameMoment) ?? null}
          onCancel={() => setEditingFrameMoment(null)}
          onSave={(frame) => {
            setFrame(editingFrameMoment, frame)
            setEditingFrameMoment(null)
          }}
        />
      )}
    </div>
  )
}

// â”€â”€â”€ Moment picker (grouped) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function HifiLiveSelectionPreview({
  snapshot,
  ai,
  widgetIds,
  moment
}: {
  snapshot: TelemetrySnapshot | null
  ai: HifiAiContext
  widgetIds: string[]
  moment: RaceMomentState | null
}): ReactElement {
  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ ...subTitle, margin: 0 }}>AI live selection</h2>
        <span style={{ ...liveBadge, color: CHROME, borderColor: CHROME }}>Local heuristic</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Moment: <strong style={{ color: 'var(--text-primary)' }}>{moment ? momentLabel(moment.moment) : 'Detecting'}</strong>
        </span>
      </div>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
        When the adaptive dashboard is on, this preview shows the ordered hi-fi widgets selected from live telemetry,
        coach/engineer state, and the detected race moment. It is fully local and deterministic.
      </p>
      <div style={liveGrid}>
        {widgetIds.map((id) => {
          const mod = HIFI_WIDGETS_BY_ID[id]
          if (!mod) return null
          const width = Math.max(180, Math.min(360, mod.defaultSize.w))
          const height = Math.max(120, Math.min(220, mod.defaultSize.h))
          return (
            <div key={id} style={liveTile}>
              <div style={liveTileHeader}>
                <strong>{mod.title}</strong>
                <span>{mod.category}</span>
              </div>
              <div style={liveWidgetSurface}>{mod.render({ snapshot, ai, width, height })}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function MomentPicker({ used, onAdd }: { used: ReadonlySet<string>; onAdd: (id: string) => void }): ReactElement {
  const [pick, setPick] = useState('')
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...select, flex: 1 }}>
        <option value="">+ Add moment?</option>
        {GROUP_ORDER.map((group) => {
          const items = MOMENT_CATALOG.filter((m) => m.group === group)
          if (items.length === 0) return null
          return (
            <optgroup key={group} label={MOMENT_GROUP_LABELS[group]}>
              {items.map((m) => (
                <option key={m.id} value={m.id} disabled={used.has(m.id)}>
                  {m.label}
                  {m.detectable === false ? ' Â· coming soon' : ''}
                  {used.has(m.id) ? ' âœ“' : ''}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
      <button
        type="button"
        disabled={!pick}
        onClick={() => {
          if (pick) onAdd(pick)
          setPick('')
        }}
        style={secondaryBtn}
      >
        Add
      </button>
    </div>
  )
}

function RuleRow({
  rule,
  active,
  onSelect,
  onToggle,
  onRemove
}: {
  rule: AdaptiveMomentRule
  active: boolean
  onSelect: () => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}): ReactElement {
  const count = Object.keys(rule.elements ?? {}).length
  const enabled = rule.enabled !== false
  const hasFrame = (rule.frame?.elements?.length ?? 0) > 0
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${active ? CHROME : 'var(--border-default)'}`,
        background: active ? 'var(--surface-sunken)' : 'transparent',
        opacity: enabled ? 1 : 0.55
      }}
    >
      <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} title="Enable/disable rule" />
      <button
        type="button"
        onClick={onSelect}
        style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong style={{ fontSize: 13 }}>{momentLabel(rule.moment)}</strong>
          {hasFrame && <FrameBadge />}
          {!momentIsDetectable(rule.moment) && <NotDetectableBadge />}
        </span>
        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11 }}>
          {hasFrame ? `frame: ${rule.frame?.elements.length} widget(s)` : `${count} adjustment(s)`}
          {rule.blinkDashboard ? ' ? blinks panel' : ''}
        </span>
      </button>
      <button type="button" onClick={onRemove} title="Remove" style={iconBtn}>
        âœ•
      </button>
    </div>
  )
}

// â”€â”€â”€ Per-moment rule editor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RuleEditor({
  rule,
  elements,
  onDashboardBlink,
  onElementRule,
  onEditFrame,
  onResetFrame
}: {
  rule: AdaptiveMomentRule
  elements: DashboardElement[]
  onDashboardBlink: (blink: AdaptiveBlink | null) => void
  onElementRule: (elementId: string, patch: AdaptiveElementRule | null) => void
  onEditFrame: () => void
  onResetFrame: () => void
}): ReactElement {
  const hasFrame = (rule.frame?.elements?.length ?? 0) > 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ ...subTitle, marginBottom: 2 }}>{momentLabel(rule.moment)}</h2>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Configure por widget: show/esconder, destaque e blink. As regras se aplicam sobre o plano automÃ¡tico.
        </span>
        {!momentIsDetectable(rule.moment) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${AMBER}`,
              background: 'color-mix(in srgb, var(--accent-warning) 10%, transparent)',
              color: AMBER,
              fontSize: 12
            }}
          >
            <NotDetectableBadge />
            <span>
              A detecÃ§Ã£o deste momento ainda no estÃ¡ disponÃ­vel. A regra fica salva, mas no dispara em pista por
              enquanto.
            </span>
          </div>
        )}
      </div>

      {/* Full per-moment FRAME (complete layout) */}
      <div style={{ ...hintTile, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>Frame for this moment (full layout)</strong>
          {hasFrame && <FrameBadge />}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Open the full editor to <strong>add</strong>, <strong>remove</strong>, <strong>move</strong>, and{' '}
          <strong>resize</strong> widgets only for this moment. When active on track, the panel switches to this layout.
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onEditFrame} style={primaryBtn}>
            {hasFrame ? 'Edit frame for this moment' : 'Create frame for this moment'}
          </button>
          {hasFrame && (
            <button type="button" onClick={onResetFrame} style={secondaryBtn}>
              Remove frame (return to base)
            </button>
          )}
        </div>
      </div>

      {/* Whole-dashboard blink */}
      <div style={{ ...hintTile, gap: 8 }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>Blink the whole panel</strong>
        <BlinkEditor blink={rule.blinkDashboard} onChange={onDashboardBlink} />
      </div>

      {/* Element list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {elements.length === 0 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>This dashboard has no widgets.</span>
        )}
        {elements.map((el) => (
          <ElementRow key={el.id} element={el} rule={rule.elements?.[el.id]} onChange={(patch) => onElementRule(el.id, patch)} />
        ))}
      </div>
    </div>
  )
}

// â”€â”€â”€ Full per-moment FRAME editor (modal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function cloneElements(elements: DashboardElement[]): DashboardElement[] {
  const sc = (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone
  if (sc) return sc(elements)
  return JSON.parse(JSON.stringify(elements)) as DashboardElement[]
}

function FrameEditorModal({
  dash,
  rule,
  onCancel,
  onSave
}: {
  dash: Dashboard
  rule: AdaptiveMomentRule | null
  onCancel: () => void
  onSave: (frame: AdaptiveMomentFrame) => void
}): ReactElement {
  // Seed from an existing frame, else from the BASE dashboard layout (clone), so
  // the user starts from the current dashboard and tweaks per moment.
  const [board, setBoard] = useState<EditableBoard>(() => ({
    width: dash.width,
    height: dash.height,
    bg: rule?.frame?.bg ?? dash.bg,
    elements: cloneElements(rule?.frame?.elements ?? dash.elements)
  }))

  const seededFromBase = !(rule?.frame?.elements?.length ?? 0)

  const reseedFromBase = useCallback(() => {
    setBoard({ width: dash.width, height: dash.height, bg: dash.bg, elements: cloneElements(dash.elements) })
  }, [dash])

  const save = useCallback(() => {
    onSave({
      elements: board.elements,
      bg: board.bg !== dash.bg ? board.bg : undefined,
      updatedAt: Date.now()
    })
  }, [board, dash.bg, onSave])

  return (
    <div style={modalOverlay} role="dialog" aria-modal="true">
      <div style={modalCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <span style={{ ...eyebrow, color: CHROME }}>Frame Â· full editor</span>
            <h2 style={{ margin: '2px 0 0', fontSize: 18, color: 'var(--text-primary)' }}>
              {momentLabel(rule?.moment ?? '')}
            </h2>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {seededFromBase ? 'New frame from the base layout.' : 'Editing the saved frame for this moment.'} Add,
              move, resize, and configure widgets only for this moment.
            </span>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            Background
            <input
              type="color"
              value={board.bg || '#000000'}
              onChange={(e) => setBoard((b) => ({ ...b, bg: e.target.value }))}
              style={{ width: 30, height: 26, padding: 0, border: '1px solid var(--border-default)', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
              aria-label="Frame background color"
            />
          </label>
          <button type="button" onClick={reseedFromBase} style={secondaryBtn}>
            Reset to base
          </button>
          <button type="button" onClick={onCancel} style={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={save} style={primaryBtn}>
            Save frame
          </button>
        </div>

        <DashboardCanvasEditor board={board} onChange={setBoard} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Frame preview</span>
          <DashboardCanvasSurface board={board} />
        </div>
      </div>
    </div>
  )
}

function ElementRow({
  element,
  rule,
  onChange
}: {
  element: DashboardElement
  rule: AdaptiveElementRule | undefined
  onChange: (patch: AdaptiveElementRule | null) => void
}): ReactElement {
  const r: AdaptiveElementRule = rule ?? {}
  const visMode: 'default' | 'show' | 'hide' = r.visible === true ? 'show' : r.visible === false ? 'hide' : 'default'
  const emphasisOn = typeof r.emphasis === 'number' && r.emphasis > 1
  const merge = (patch: AdaptiveElementRule): void => onChange({ ...r, ...patch })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-default)',
        background: 'var(--surface-sunken)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-primary)', fontSize: 13, flex: 1 }}>{elementLabel(element)}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'monospace' }}>{element.type}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <SegBtn active={visMode === 'default'} onClick={() => merge({ visible: undefined })} label="PadrÃ£o" />
        <SegBtn active={visMode === 'show'} onClick={() => merge({ visible: true })} label="Mostrar" color={GOOD} />
        <SegBtn active={visMode === 'hide'} onClick={() => merge({ visible: false })} label="Esconder" color={DANGER} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={emphasisOn}
            onChange={(e) => merge({ emphasis: e.target.checked ? 1.2 : undefined })}
          />
          Highlight
        </label>
        {emphasisOn && (
          <>
            <input
              type="range"
              min={105}
              max={160}
              step={5}
              value={Math.round((r.emphasis ?? 1.2) * 100)}
              onChange={(e) => merge({ emphasis: Number(e.target.value) / 100 })}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36 }}>
              {Math.round((r.emphasis ?? 1.2) * 100)}%
            </span>
          </>
        )}
      </div>

      <BlinkEditor blink={r.blink} onChange={(blink) => merge({ blink: blink ?? undefined })} />
    </div>
  )
}

function BlinkEditor({
  blink,
  onChange
}: {
  blink: AdaptiveBlink | undefined
  onChange: (blink: AdaptiveBlink | null) => void
}): ReactElement {
  const on = !!blink
  const color = blink?.color ?? '#FF7A00'
  const hz = blink?.hz ?? DEFAULT_BLINK_HZ
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? { color, hz } : null)} />
        Blink
      </label>
      {on && (
        <>
          <input
            type="color"
            value={color}
            onChange={(e) => onChange({ color: e.target.value, hz })}
            style={{ width: 28, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            aria-label="Color do blink"
          />
          <div style={{ display: 'flex', gap: 3 }}>
            {BLINK_SWATCHES.map((s) => (
              <button
                key={s.color}
                type="button"
                title={s.label}
                onClick={() => onChange({ color: s.color, hz })}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border:
                    color.toLowerCase() === s.color.toLowerCase()
                      ? '2px solid var(--text-primary)'
                      : '1px solid var(--border-default)',
                  background: s.color,
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={5}
            max={40}
            step={1}
            value={Math.round(hz * 10)}
            onChange={(e) => onChange({ color, hz: Number(e.target.value) / 10 })}
            aria-label="Velocidade do blink"
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 44 }}>{hz.toFixed(1)} Hz</span>
        </>
      )}
    </div>
  )
}

function SegBtn({
  active,
  onClick,
  label,
  color
}: {
  active: boolean
  onClick: () => void
  label: string
  color?: string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '3px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        border: `1px solid ${active ? color ?? CHROME : 'var(--border-default)'}`,
        background: active ? color ?? CHROME : 'transparent',
        color: active ? '#05070a' : 'var(--text-secondary)'
      }}
    >
      {label}
    </button>
  )
}

// â”€â”€â”€ styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const eyebrow: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: 'uppercase'
}

const card: CSSProperties = {
  background: 'var(--surface-base)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)'
}

const subTitle: CSSProperties = { margin: '0 0 10px', fontSize: 15, color: 'var(--text-primary)' }

const hintTile: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 10px'
}

const liveBadge: CSSProperties = {
  flex: '0 0 auto',
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
  padding: '3px 7px',
  borderRadius: 999,
  border: '1px solid currentColor',
  textTransform: 'uppercase',
  letterSpacing: 0.6
}

const liveGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
  marginTop: 12
}

const liveTile: CSSProperties = {
  minWidth: 0,
  minHeight: 190,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-sunken)'
}

const liveTileHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  color: 'var(--text-primary)',
  fontSize: 12
}

const liveWidgetSurface: CSSProperties = {
  flex: 1,
  minHeight: 150,
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden'
}

const select: CSSProperties = {
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 13
}

const primaryBtn: CSSProperties = {
  background: CHROME,
  color: '#05070a',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontWeight: 800,
  cursor: 'pointer'
}

const secondaryBtn: CSSProperties = {
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: '7px 14px',
  fontWeight: 700,
  cursor: 'pointer'
}

const iconBtn: CSSProperties = {
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  width: 26,
  height: 26,
  cursor: 'pointer',
  fontWeight: 700
}

const modalOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'color-mix(in srgb, #05070a 78%, transparent)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 'var(--space-5)',
  overflowY: 'auto',
  zIndex: 1000
}

const modalCard: CSSProperties = {
  background: 'var(--surface-base)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-5)',
  width: 'min(1200px, 96vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  margin: 'auto'
}

