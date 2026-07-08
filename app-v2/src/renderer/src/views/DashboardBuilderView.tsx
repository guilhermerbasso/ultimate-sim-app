import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import type { Dashboard, DashboardElement, DashboardSummary } from '../../../shared/dashboards'
import {
  DASHBOARD_AI_CHANNELS,
  type DashboardAiBuildRequest,
  type DashboardAiBuildResponse
} from '../../../shared/dashboard-ai-ipc'
import { applyAdaptivePlan, withRaceMoment, type AdaptivePlan, type Emphasis, type MomentApply } from '../../../shared/dashboard-adaptive'
import {
  resolveRaceMoment,
  initialRaceMomentState,
  raceMomentPreset,
  type RaceMomentState,
  type RaceMomentColor
} from '../../../shared/race-moment'
import { PREDICTIONS_CHANNELS, type PredictionsSnapshot } from '../../../shared/predictions'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { DetailLevel } from '../../../shared/dashboard-nl'
import { DASHBOARD_BLUEPRINTS, type DashboardArchetype } from '../../../shared/dashboard-blueprints'
import { OVERLAY_DESIGN_FAMILIES, type OverlayDesignFamily } from '../../../shared/overlays'
import { CanvasElementVisual } from './dashboard/DashboardCanvasEditor'

// Warm chrome throughout (Carbon Orange / Amber); green (--accent-success) is
// reserved for "good" confirmations only, per the dashboard colour rule.
const CHROME = 'var(--accent-primary)'
const AMBER = 'var(--accent-warning)'
const GOOD = 'var(--accent-success)'
const DANGER = 'var(--accent-danger)'

// Map an abstract moment colour token to a concrete chrome colour.
const MOMENT_COLOR_CSS: Record<RaceMomentColor, string> = {
  normal: CHROME,
  caution: AMBER,
  critical: DANGER,
  good: GOOD
}

// Recompute the micro race-moment at ~7 Hz (NOT per frame) — anti-flicker.
const MOMENT_RECOMPUTE_MS = 140

const BOARD_W = 1024
const BOARD_H = 600

const EXAMPLE_PHRASES = [
  'Fuel, posição e delta',
  'Tires, temperatures, and brakes',
  'Qualifying: delta and lap time',
  'Gear, speed, RPM, and g-force',
  'Radar, relative, and track map'
]

// Archetype + family pickers (manual selection drives the same deterministic
// engine — works perfectly with the local AI OFF).
const ARCHETYPE_OPTIONS: Array<{ id: DashboardArchetype; label: string }> = DASHBOARD_BLUEPRINTS.map((bp) => ({
  id: bp.id,
  label: bp.label
}))

const FAMILY_LABELS: Record<OverlayDesignFamily, string> = {
  minimal: 'Minimal',
  neon: 'Neon',
  glass: 'Glass',
  broadcast: 'Broadcast',
  terminal: 'Terminal',
  bauhaus: 'Bauhaus',
  analog: 'Analógico',
  heatmap: 'Heatmap'
}

const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)'
}

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 72,
  resize: 'vertical',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  padding: 'var(--space-3) var(--space-4)',
  font: 'inherit'
}

const selectStyle: CSSProperties = {
  height: 32,
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  padding: '0 var(--space-3)'
}

const primaryBtn: CSSProperties = {
  background: CHROME,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)',
  height: 36,
  padding: '0 var(--space-6)',
  fontWeight: 600,
  cursor: 'pointer'
}

const ghostBtn: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  height: 36,
  padding: '0 var(--space-5)',
  cursor: 'pointer'
}

function chip(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    padding: '2px 10px',
    borderRadius: 'var(--radius-pill)',
    border: `1px solid ${color}`,
    color,
    background: 'transparent'
  }
}

function selectableChip(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 12,
    padding: '4px 12px',
    borderRadius: 'var(--radius-pill)',
    border: `1px solid ${active ? CHROME : 'var(--border-strong)'}`,
    color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
    background: active ? CHROME : 'transparent',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer'
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function archetypeLabel(id: DashboardArchetype): string {
  return ARCHETYPE_OPTIONS.find((o) => o.id === id)?.label ?? id
}

export default function DashboardBuilderView({ showToast }: AppViewProps): ReactElement {
  const [phrase, setPhrase] = useState('')
  const [detail, setDetail] = useState<DetailLevel>('auto')
  const [useLlm, setUseLlm] = useState(true)
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState<DashboardAiBuildResponse | null>(null)

  // Manual pickers — null means "deixe a IA/palavras-chave decidir".
  const [archetype, setArchetype] = useState<DashboardArchetype | null>(null)
  const [family, setFamily] = useState<OverlayDesignFamily | null>(null)

  const [adaptiveOn, setAdaptiveOn] = useState(false)
  const [plan, setPlan] = useState<AdaptivePlan | null>(null)

  // ── Micro "race moment" layer (anti-flicker state machine) ────────────────
  // The reducer state is kept in a ref (mutated by the recompute loop) and a
  // serial counter forces a re-render when the committed moment changes.
  const momentRef = useRef<RaceMomentState | null>(null)
  const liveSnapshotRef = useRef<TelemetrySnapshot | null>(null)
  const predictionsRef = useRef<PredictionsSnapshot | null>(null)
  const [momentState, setMomentState] = useState<RaceMomentState | null>(null)

  const dashboard: Dashboard | null = result?.dashboard ?? null

  const runBuild = useCallback(
    async (overrides?: Partial<DashboardAiBuildRequest>) => {
      if (building) return
      const text = phrase.trim()
      const req: DashboardAiBuildRequest = {
        phrase: text,
        useLlm,
        detail,
        ...(archetype ? { archetype } : {}),
        ...(family ? { family } : {}),
        ...overrides
      }
      // Allow building with an empty phrase as long as an archetype is chosen.
      if (!req.phrase && !req.archetype) {
        showToast('Descreva o dashboard ou escolha um arquétipo.', 'info')
        return
      }
      setBuilding(true)
      try {
        const res = await window.ipc.invoke<DashboardAiBuildResponse>(DASHBOARD_AI_CHANNELS.build, req)
        setResult(res)
        // Keep the pickers in sync with what was actually produced.
        setArchetype(res.archetype)
        setFamily(res.family)
        if (res.usedDefault) showToast('Nada reconhecido na frase — usei um layout padrão.', 'info')
      } catch (error) {
        showToast(`Failed to generate dashboard: ${getErrorMessage(error)}`, 'error')
      } finally {
        setBuilding(false)
      }
    },
    [phrase, building, useLlm, detail, archetype, family, showToast]
  )

  const build = useCallback(() => void runBuild(), [runBuild])

  // Regenerate a variation: keep the produced archetype, cycle to the next
  // design family. Fully deterministic — works with the LLM off.
  const regenerate = useCallback(() => {
    if (!result) return
    const idx = OVERLAY_DESIGN_FAMILIES.indexOf(result.family)
    const nextFamily = OVERLAY_DESIGN_FAMILIES[(idx + 1) % OVERLAY_DESIGN_FAMILIES.length]
    void runBuild({ archetype: result.archetype, family: nextFamily })
  }, [result, runBuild])

  const refreshPlan = useCallback(async () => {
    try {
      const next = await window.ipc.invoke<AdaptivePlan>(DASHBOARD_AI_CHANNELS.adaptiveSuggest)
      setPlan(next)
    } catch {
      // adaptive is best-effort; ignore transient errors
    }
  }, [])

  // Poll the adaptive plan from live telemetry while adaptive mode is on.
  useEffect(() => {
    if (!adaptiveOn) return
    void refreshPlan()
    const id = window.setInterval(() => void refreshPlan(), 2000)
    return () => window.clearInterval(id)
  }, [adaptiveOn, refreshPlan])

  // Micro race-moment: subscribe to live telemetry + predictions and run the
  // anti-flicker reducer at ~7 Hz. Predictions are best-effort (the channel is
  // a no-op until WS-G is wired) — the reducer degrades to telemetry-only.
  useEffect(() => {
    if (!adaptiveOn) {
      momentRef.current = null
      setMomentState(null)
      return
    }
    momentRef.current = initialRaceMomentState()
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snap) => {
      liveSnapshotRef.current = snap
    })
    let offPredictions: (() => void) | undefined
    try {
      offPredictions = window.ipc.subscribe<PredictionsSnapshot | null>(PREDICTIONS_CHANNELS.snapshot, (snap) => {
        predictionsRef.current = snap
      })
    } catch {
      // predictions channel not registered yet — telemetry-only fallback
    }
    const id = window.setInterval(() => {
      const next = resolveRaceMoment(liveSnapshotRef.current, predictionsRef.current, momentRef.current)
      momentRef.current = next
      // Only re-render when the committed hero moment actually changes.
      setMomentState((cur) => (cur && cur.moment === next.moment && cur.color === next.color ? cur : next))
    }, MOMENT_RECOMPUTE_MS)
    return () => {
      offTelemetry?.()
      offPredictions?.()
      window.clearInterval(id)
    }
  }, [adaptiveOn])

  const createDashboard = useCallback(
    async (open: boolean) => {
      if (!dashboard) return
      try {
        await window.ipc.invoke<DashboardSummary>('app:dash:save', dashboard)
        if (open) await window.ipc.invoke('app:dash:open', dashboard.id, { fullscreen: false })
        showToast(open ? 'Dashboard created and opened.' : 'Dashboard created and saved.', 'success')
      } catch (error) {
        showToast(`Failed to create dashboard: ${getErrorMessage(error)}`, 'error')
      }
    },
    [dashboard, showToast]
  )

  // Apply the adaptive plan to the preview when adaptive mode is on. The micro
  // moment layer is merged into the plan so the same applier yields the
  // promote/demote/recolor decisions; positions are never changed.
  const previewElements = useMemo<Array<{ element: DashboardElement; emphasis: Emphasis; moment?: MomentApply }>>(() => {
    if (!dashboard) return []
    if (adaptiveOn && plan) {
      const merged = withRaceMoment(plan, momentState)
      return applyAdaptivePlan(dashboard.elements, merged)
        .filter((r) => r.element.visible !== false)
        .map((r) => ({ element: r.element, emphasis: r.emphasis, moment: r.moment }))
    }
    return dashboard.elements.map((element) => ({ element, emphasis: 'show' as Emphasis }))
  }, [dashboard, adaptiveOn, plan, momentState])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...labelStyle, color: CHROME }}>IA local · opcional</span>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text-primary)' }}>AI Dashboard</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 720 }}>
          Descreva o dashboard que você quer e a IA monta para você. Sem modelo de IA disponível? O construtor cai
          automaticamente em correspondência por palavras-chave (PT-BR e inglês) — sempre funciona offline.
        </p>
      </header>

      {/* ── Builder ─────────────────────────────────────────────────────── */}
      <section style={card}>
        <label style={labelStyle} htmlFor="dashai-phrase">
          Describe your dashboard
        </label>
        <textarea
          id="dashai-phrase"
          style={textareaStyle}
          placeholder="ex.: combustível, posição, delta e temperatura de pneu"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) build()
          }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EXAMPLE_PHRASES.map((ex) => (
            <button key={ex} type="button" style={{ ...chip(AMBER), cursor: 'pointer' }} onClick={() => setPhrase(ex)}>
              {ex}
            </button>
          ))}
        </div>

        {/* Manual archetype chips — drive the deterministic engine (works LLM-off). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Arquétipo</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              style={selectableChip(archetype === null)}
              onClick={() => setArchetype(null)}
            >
              Auto
            </button>
            {ARCHETYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                style={selectableChip(archetype === opt.id)}
                onClick={() => setArchetype((cur) => (cur === opt.id ? null : opt.id))}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Family / theme picker — coherent visual family for the whole dash. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Tema / família visual</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" style={selectableChip(family === null)} onClick={() => setFamily(null)}>
              Auto
            </button>
            {OVERLAY_DESIGN_FAMILIES.map((f) => (
              <button
                key={f}
                type="button"
                style={selectableChip(family === f)}
                onClick={() => setFamily((cur) => (cur === f ? null : f))}
              >
                {FAMILY_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <span style={labelStyle}>Style</span>
            <select style={selectStyle} value={detail} onChange={(e) => setDetail(e.target.value as DetailLevel)}>
              <option value="auto">Automático</option>
              <option value="clean">Clean / minimal</option>
              <option value="elaborate">Detailed</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
            Usar IA local (se disponível)
          </label>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{ ...primaryBtn, opacity: building || (!phrase.trim() && !archetype) ? 0.6 : 1 }}
            disabled={building || (!phrase.trim() && !archetype)}
            onClick={build}
          >
            {building ? 'Gerando…' : 'Generate preview'}
          </button>
        </div>
      </section>

      {/* ── Result + preview ────────────────────────────────────────────── */}
      {dashboard && (
        <section style={card}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center' }}>
            <span style={chip(result?.source === 'llm' ? CHROME : AMBER)}>
              {result?.source === 'llm' ? '✦ IA local' : '⌘ Palavras-chave'}
            </span>
            {result && <span style={chip(CHROME)}>{archetypeLabel(result.archetype)}</span>}
            {result && <span style={chip(AMBER)}>{FAMILY_LABELS[result.family]}</span>}
            <span style={{ color: 'var(--text-secondary)' }}>{dashboard.elements.length} widgets</span>
            {result?.matched?.map((c) => (
              <span key={c} style={chip('var(--border-strong)')}>
                {c}
              </span>
            ))}
            <div style={{ flex: 1 }} />
            <button type="button" style={ghostBtn} onClick={regenerate}>
              Regenerar variação
            </button>
            <button type="button" style={ghostBtn} onClick={() => void createDashboard(false)}>
              Criar
            </button>
            <button type="button" style={primaryBtn} onClick={() => void createDashboard(true)}>
              Create and open
            </button>
          </div>

          {result?.llmNote && <p style={{ margin: 0, color: AMBER, fontSize: 13 }}>{result.llmNote}</p>}

          <DashboardPreview elements={previewElements} bg={dashboard.bg} />

          {/* ── Adaptive mode ──────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontWeight: 600 }}>
                <input type="checkbox" checked={adaptiveOn} onChange={(e) => setAdaptiveOn(e.target.checked)} />
                Adaptive mode
              </label>
              {adaptiveOn && (
                <button type="button" style={{ ...ghostBtn, height: 28 }} onClick={() => void refreshPlan()}>
                  Refresh
                </button>
              )}
            </div>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, maxWidth: 760 }}>
              O modo adaptativo lê a telemetria ao vivo e reorganiza o painel por fase da sessão — quali foca em delta e
              tempo de volta, corrida em posição/gap/combustível, pit em pneus e box. As regras são determinísticas (sem IA).
            </p>
            {adaptiveOn && plan && <AdaptiveExplainer plan={plan} />}
            {adaptiveOn && momentState && momentState.moment !== 'clear-running' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={labelStyle}>Moment</span>
                <span style={chip(MOMENT_COLOR_CSS[momentState.color])}>{raceMomentPreset(momentState.moment).label}</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Preview ───────────────────────────────────────────────────────────────

function DashboardPreview({ elements, bg }: { elements: Array<{ element: DashboardElement; emphasis: Emphasis; moment?: MomentApply }>; bg: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)

  useEffect(() => {
    const measure = (): void => {
      if (ref.current) setWidth(ref.current.clientWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const scale = width / BOARD_W

  return (
    <div ref={ref} style={{ width: '100%', height: Math.round(BOARD_H * scale), position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: BOARD_W, height: BOARD_H, background: bg || '#000', transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {elements.map(({ element, emphasis, moment }) => {
          // Micro moment → CSS only (scale/opacity/colour). Positions never move,
          // so a mid-lap switch can't relayout the board. Tween 200ms.
          const promoted = moment?.action === 'promote'
          const demoted = moment?.action === 'demote'
          const momentColor = moment ? MOMENT_COLOR_CSS[moment.color] : undefined
          const outlineColor = promoted ? momentColor ?? CHROME : emphasis === 'emphasize' ? CHROME : undefined
          return (
            <div
              key={element.id}
              style={{
                position: 'absolute',
                left: element.x,
                top: element.y,
                width: element.w,
                height: element.h,
                boxSizing: 'border-box',
                borderRadius: element.style.radius ?? 8,
                outline: outlineColor ? `2px solid ${outlineColor}` : undefined,
                outlineOffset: 1,
                opacity: moment?.opacity ?? 1,
                transform: moment ? `scale(${moment.scale})` : undefined,
                transformOrigin: 'center center',
                zIndex: promoted ? 50 : demoted ? 1 : undefined,
                boxShadow: promoted && momentColor ? `0 0 14px ${momentColor}` : undefined,
                transition: 'transform 200ms ease, opacity 200ms ease, outline-color 200ms ease, box-shadow 200ms ease'
              }}
            >
              <CanvasElementVisual element={element} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Adaptive explainer ──────────────────────────────────────────────────────

function AdaptiveExplainer({ plan }: { plan: AdaptivePlan }): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={chip(CHROME)}>{plan.phase}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{plan.reason}</span>
      </div>
      <ConceptRow label="Highlight" color={CHROME} concepts={plan.emphasize} />
      <ConceptRow label="Mostrar" color="var(--border-strong)" concepts={plan.show} />
      <ConceptRow label="Ocultar" color="var(--text-muted)" concepts={plan.hide} />
    </div>
  )
}

function ConceptRow({ label, color, concepts }: { label: string; color: string; concepts: string[] }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ ...labelStyle, minWidth: 72 }}>{label}</span>
      {concepts.length === 0 ? (
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
      ) : (
        concepts.map((c) => (
          <span key={c} style={{ ...chip(color), fontSize: 11 }}>
            {c}
          </span>
        ))
      )}
    </div>
  )
}
