// Catalogo de widgets (galeria visual) compartilhado pelo editor de dashboards
// (DashboardsView) e pelo construtor de overlays (OverlayWidgetBuilder). Os data
// puros (variantes + taxonomia + filtros) vivem em widget-catalog-data.ts; este
// arquivo cuida so da UI React: miniaturas ao vivo + galeria com busca e filtros
// por categoria/estilo. As miniaturas reaproveitam os renderers GT3/extra ao vivo
// com um snapshot simulado e fallbacks statics para os tipos legados.

import { useMemo, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { GT3_WIDGET_TYPES, renderGt3Widget } from '../../dashboard/widgets/gt3-widgets'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import {
  ACCENT,
  ALL_VARIANTS,
  GT3_PANEL,
  GT3_STROKE,
  NEW_VARIANTS,
  NEW_WIDGET_KINDS,
  TEXT_DIM,
  TEXT_FG,
  WIDGET_CATALOG,
  filterVariants,
  filterHiddenVariants,
  groupVariantsByCategory,
  partitionByAdvanced,
  variantToElement,
  type NormalizedVariant,
  type WidgetCategory,
  type WidgetVariant
} from './widget-catalog-data'
import {
  WIDGET_CATEGORY_LABELS,
  WIDGET_CLUSTER_LABELS,
  WIDGET_STYLE_LABELS,
  availableCategories,
  availableClusters,
  availableStyles,
  groupVariantsByCluster,
  type WidgetCategoryTag,
  type WidgetClusterTag,
  type WidgetStyleFamily
} from '../../../../shared/widget-taxonomy'
import { PLAYABLE_SIMS, simLabel, type CoverageSimId } from '../../../../shared/sim-coverage'

export type { WidgetVariant, WidgetCategory, NormalizedVariant }
export { variantToElement, WIDGET_CATALOG, ALL_VARIANTS, NEW_VARIANTS, NEW_WIDGET_KINDS, filterVariants, groupVariantsByCategory, filterHiddenVariants }

const WIDGET_HIDDEN_STORAGE_KEY = 'usa.dashboardWidgetCatalog.hidden'

function readHiddenWidgetIds(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = window.localStorage.getItem(WIDGET_HIDDEN_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistHiddenWidgetIds(ids: ReadonlySet<string>): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WIDGET_HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // localStorage can be unavailable in tests or restricted environments.
  }
}

// ─── Miniatura ──────────────────────────────────────────────────────────────
const PREVIEW_W = 168
const PREVIEW_H = 92

function LegacyMini({ variant }: { variant: WidgetVariant }): ReactElement {
  const s = variant.style
  const fill = s.fillColor ?? ACCENT
  if (variant.type === 'text') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: s.color ?? TEXT_FG, fontWeight: 800, fontSize: 22 }}>{s.text ?? 'Texto'}</div>
  }
  if (variant.type === 'rect') {
    return <div style={{ width: '78%', height: '64%', margin: 'auto', marginTop: '14%', background: s.background ?? GT3_PANEL, border: `1px solid ${s.border ?? GT3_STROKE}`, borderRadius: s.radius ?? 12 }} />
  }
  if (variant.type === 'bar') {
    return <div style={{ width: '86%', height: 18, margin: 'auto', marginTop: '36%', background: '#0a0c10', borderRadius: 8, overflow: 'hidden' }}><div style={{ width: '62%', height: '100%', background: fill }} /></div>
  }
  if (variant.type === 'gauge') {
    return (
      <svg viewBox="0 0 100 60" style={{ width: '100%', height: '100%' }}>
        <path d="M10,55 A40,40 0 0,1 90,55" fill="none" stroke="#0a0c10" strokeWidth="9" />
        <path d="M10,55 A40,40 0 0,1 72,22" fill="none" stroke={fill} strokeWidth="9" />
      </svg>
    )
  }
  if (variant.type === 'shiftlights') {
    const segs = Math.max(6, Math.min(16, s.segments ?? 12))
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${segs}, 1fr)`, gap: 3, width: '88%', height: 22, margin: 'auto', marginTop: '34%' }}>
        {Array.from({ length: segs }, (_, i) => (
          <div key={i} style={{ background: i < segs * 0.45 ? (s.fillColor ?? '#2FFF67') : '#1a2230', borderRadius: 3 }} />
        ))}
      </div>
    )
  }
  if (variant.type === 'image') {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: TEXT_DIM, fontSize: 12 }}>🖼 imagem</div>
  }
  if (variant.type === 'table' || variant.type === 'standings') {
    return (
      <div style={{ width: '90%', margin: 'auto', marginTop: '10%', fontSize: 12, color: TEXT_DIM }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 6, padding: '2px 0', color: i === 1 ? ACCENT : TEXT_FG, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ width: 12 }}>{i + 1}</span><span style={{ flex: 1 }}>Driver {i + 1}</span><span>{i === 1 ? '0.0' : '+0.4'}</span>
          </div>
        ))}
      </div>
    )
  }
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: TEXT_DIM, fontSize: 12 }}>{variant.label}</div>
}

export function WidgetMini({ variant }: { variant: WidgetVariant }): ReactElement {
  const isLive = (GT3_WIDGET_TYPES as readonly string[]).includes(variant.type)
  return (
    <div style={{ position: 'relative', width: '100%', height: PREVIEW_H, background: '#05070a', borderRadius: 8, overflow: 'hidden' }}>
      {isLive ? (
        <div style={{ position: 'absolute', inset: 0 }}>
          {renderGt3Widget({ element: { ...variantToElement(variant, 0, 0), w: PREVIEW_W, h: PREVIEW_H }, snapshot: PREVIEW_SNAPSHOT })}
        </div>
      ) : (
        <LegacyMini variant={variant} />
      )}
    </div>
  )
}

// ─── Galeria com busca + filtros ──────────────────────────────────────────────
const ALL_CATEGORIES = availableCategories(ALL_VARIANTS)
const ALL_STYLES = availableStyles(ALL_VARIANTS)
const ALL_CLUSTERS = availableClusters(ALL_VARIANTS)

export function WidgetGallery({
  onAdd,
  busy
}: {
  onAdd(variant: WidgetVariant): void
  busy?: boolean
}): ReactElement {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<WidgetCategoryTag | null>(null)
  const [cluster, setCluster] = useState<WidgetClusterTag | null>(null)
  const [styleFamily, setStyleFamily] = useState<WidgetStyleFamily | null>(null)
  const [sim, setSim] = useState<CoverageSimId | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => readHiddenWidgetIds())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const filtered = useMemo(
    () => filterHiddenVariants(filterVariants(ALL_VARIANTS, { search, category, cluster, styleFamily, sim }), hiddenIds),
    [search, category, cluster, styleFamily, sim, hiddenIds]
  )
  const hiddenVariants = useMemo(() => ALL_VARIANTS.filter((variant) => hiddenIds.has(variant.id)), [hiddenIds])
  // Curated GT3 widgets/templates lead; the ~201 generated raw iRacing channels
  // are demoted behind a collapsed "advanced" accordion (still fully reachable
  // via search/expand). The curated axis is now sectioned by HARDWARE CLUSTER
  // (real-dashboard grouping: DDU page, tell-tale bank, stint panel…) so the user
  // sees GT3-cluster categorization; any curated variant without a cluster falls
  // back to its domain category section. The advanced axis stays domain-grouped.
  const { curated, advanced } = useMemo(() => partitionByAdvanced(filtered), [filtered])
  const curatedClusterSections = useMemo(() => groupVariantsByCluster(curated), [curated])
  const curatedFallbackSections = useMemo(
    () => groupVariantsByCategory(curated.filter((v) => !v.cluster)),
    [curated]
  )
  const advancedSections = useMemo(() => groupVariantsByCategory(advanced), [advanced])

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const hasFilter =
    search.trim() !== '' || category !== null || cluster !== null || styleFamily !== null || sim !== null
  // Any active filter auto-reveals the advanced channels so matches are never hidden.
  const showAdvanced = advancedOpen || hasFilter
  const updateHiddenIds = (updater: (current: Set<string>) => Set<string>): void => {
    setHiddenIds((current) => {
      const next = updater(current)
      persistHiddenWidgetIds(next)
      return next
    })
  }
  const toggleSelected = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const hideIds = (ids: string[]): void => {
    updateHiddenIds((current) => new Set([...current, ...ids]))
    setSelectedIds(new Set())
  }
  const restoreIds = (ids: string[]): void => {
    updateHiddenIds((current) => {
      const next = new Set(current)
      ids.forEach((id) => next.delete(id))
      return next
    })
    setSelectedIds(new Set())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={toolbarStyle}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search widget (nome, categoria, tag)…"
          aria-label="Search widget"
          style={searchStyle}
        />
        <span style={{ color: TEXT_DIM, fontSize: 12, whiteSpace: 'nowrap' }}>{filtered.length} widget{filtered.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => hideIds(Array.from(selectedIds))} disabled={selectedIds.size === 0} style={clearBtnStyle}>
          Hide selected
        </button>
        {hasFilter && (
          <button type="button" onClick={() => { setSearch(''); setCategory(null); setCluster(null); setStyleFamily(null); setSim(null) }} style={clearBtnStyle} title="Clear filters">
            Clear ✕
          </button>
        )}
      </div>

      <div>
        <div style={chipRowLabel}>Category</div>
        <div style={chipRow}>
          <Chip active={category === null} onClick={() => setCategory(null)}>All</Chip>
          {ALL_CATEGORIES.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
              {WIDGET_CATEGORY_LABELS[c]}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div style={chipRowLabel}>Cluster</div>
        <div style={chipRow}>
          <Chip active={cluster === null} onClick={() => setCluster(null)}>All</Chip>
          {ALL_CLUSTERS.map((c) => (
            <Chip key={c} active={cluster === c} onClick={() => setCluster(cluster === c ? null : c)}>
              {WIDGET_CLUSTER_LABELS[c]}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div style={chipRowLabel}>Sim</div>
        <div style={chipRow}>
          <Chip active={sim === null} onClick={() => setSim(null)}>All</Chip>
          {PLAYABLE_SIMS.map((s) => (
            <Chip key={s} active={sim === s} onClick={() => setSim(sim === s ? null : s)}>
              {simLabel(s)}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div style={chipRowLabel}>Style</div>
        <div style={chipRow}>
          <Chip active={styleFamily === null} onClick={() => setStyleFamily(null)}>All</Chip>
          {ALL_STYLES.map((s) => (
            <Chip key={s} active={styleFamily === s} onClick={() => setStyleFamily(styleFamily === s ? null : s)}>
              {WIDGET_STYLE_LABELS[s]}
            </Chip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={emptyStyle}>No widget matches the filters.</div>
      ) : (
        <>
          {(curatedClusterSections.length > 0 || curatedFallbackSections.length > 0) && (
            <>
              <div style={featuredHeader}>
                <span style={featuredTitle}>★ Curated GT3</span>
                <span style={{ color: TEXT_DIM, fontWeight: 600, fontSize: 11 }}>
                  {curated.length} widget{curated.length === 1 ? '' : 's'} ready
                </span>
              </div>
              {curatedClusterSections.map((sec) => (
                <SectionGrid key={`cluster-${sec.cluster}`} label={sec.label} variants={sec.variants} busy={busy} selectedIds={selectedIds} onToggleSelected={toggleSelected} onHide={(id) => hideIds([id])} onAdd={onAdd} />
              ))}
              {curatedFallbackSections.map((sec) => (
                <SectionGrid key={`cat-${sec.category}`} label={sec.label} variants={sec.variants} busy={busy} selectedIds={selectedIds} onToggleSelected={toggleSelected} onHide={(id) => hideIds([id])} onAdd={onAdd} />
              ))}
            </>
          )}

          {advancedSections.length > 0 && (
            <div style={advancedWrap}>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                style={advancedToggle}
                aria-expanded={showAdvanced}
                title="Canais brutos de telemetria iRacing (secondary)"
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span style={{ color: TEXT_FG, fontSize: 13, fontWeight: 800 }}>Canais iRacing avancados</span>
                  <span style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 600 }}>
                    {advanced.length} channel{advanced.length === 1 ? '' : 'is'} brutos · use a busca para filtrar
                  </span>
                </span>
                <span style={{ color: ACCENT, fontSize: 16, fontWeight: 900 }}>{showAdvanced ? '▾' : '▸'}</span>
              </button>
              {showAdvanced &&
                advancedSections.map((sec) => (
                  <SectionGrid key={sec.category} label={sec.label} variants={sec.variants} busy={busy} selectedIds={selectedIds} onToggleSelected={toggleSelected} onHide={(id) => hideIds([id])} onAdd={onAdd} />
                ))}
            </div>
          )}
          {hiddenVariants.length > 0 && (
            <details>
              <summary style={{ color: TEXT_FG, cursor: 'pointer', fontWeight: 800 }}>Hidden widgets ({hiddenVariants.length})</summary>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {hiddenVariants.map((variant) => (
                  <label key={variant.id} style={{ ...clearBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={selectedIds.has(variant.id)} onChange={() => toggleSelected(variant.id)} />
                    <span>{variant.label}</span>
                    <button type="button" style={clearBtnStyle} onClick={() => restoreIds([variant.id])}>Restore</button>
                  </label>
                ))}
              </div>
              <button type="button" style={{ ...clearBtnStyle, marginTop: 10 }} disabled={selectedIds.size === 0} onClick={() => restoreIds(Array.from(selectedIds))}>Restore selected</button>
            </details>
          )}
        </>
      )}
    </div>
  )
}

// Reusable category section: a title + the responsive card grid. Shared by the
// curated sections and the advanced-channels accordion.
function SectionGrid({
  label,
  variants,
  busy,
  selectedIds,
  onToggleSelected,
  onHide,
  onAdd
}: {
  label: string
  variants: NormalizedVariant[]
  busy?: boolean
  selectedIds: ReadonlySet<string>
  onToggleSelected(id: string): void
  onHide(id: string): void
  onAdd(variant: WidgetVariant): void
}): ReactElement {
  return (
    <div>
      <div style={catTitle}>{label} <span style={{ color: TEXT_DIM, fontWeight: 600 }}>· {variants.length}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 10 }}>
        {variants.map((v) => (
          <div
            key={v.id}
            title={v.hint ?? `Add ${v.label}`}
            style={cardStyle}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 11, marginBottom: 6 }}>
              <input type="checkbox" checked={selectedIds.has(v.id)} disabled={busy} onChange={() => onToggleSelected(v.id)} />
              Select
            </label>
            <WidgetMini variant={v} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ color: TEXT_FG, fontSize: 12, fontWeight: 700, textAlign: 'left', lineHeight: 1.15 }}>{v.label}</span>
              <span style={{ color: ACCENT, fontSize: 16, fontWeight: 900, flexShrink: 0 }}>＋</span>
            </div>
            <div style={styleBadge}>{WIDGET_STYLE_LABELS[v.styleFamily]}</div>
            {v.hardwareFamily && (
              <div style={hwBadge} title={`Inspired by ${v.hardwareFamily}`}>⌁ {v.hardwareFamily}</div>
            )}
            <SimBadge sims={v.supportedSims} />
            {v.missing && (
              <div style={missingBadge} title={v.missing}>⚠ {v.missing}</div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" disabled={busy} onClick={() => onAdd(v)} style={miniActionBtn}>Add</button>
              <button type="button" disabled={busy} onClick={() => onHide(v.id)} style={miniActionBtn}>Hide</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...chipStyle,
        background: active ? 'rgba(0,231,255,0.16)' : 'transparent',
        borderColor: active ? ACCENT : GT3_STROKE,
        color: active ? TEXT_FG : TEXT_DIM
      }}
    >
      {children}
    </button>
  )
}

function SimBadge({ sims }: { sims: readonly CoverageSimId[] }): ReactElement {
  const universal = sims.length >= PLAYABLE_SIMS.length
  const none = sims.length === 0
  const text = none ? '— sem sim ao vivo' : universal ? 'All os sims' : sims.map(simLabel).join('·')
  const tone: CSSProperties = none
    ? { color: '#ffb84d', background: 'rgba(255,184,77,0.12)', borderColor: 'rgba(255,184,77,0.4)' }
    : universal
      ? { color: TEXT_DIM, background: 'rgba(255,255,255,0.04)' }
      : { color: '#bfe9ff', background: 'rgba(0,231,255,0.10)', borderColor: 'rgba(0,231,255,0.35)' }
  return (
    <div
      style={{ ...simBadge, ...tone }}
      title={`Sims com telemetria ao vivo: ${sims.map(simLabel).join(', ') || '—'}`}
    >
      {text}
    </div>
  )
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#05070a',
  paddingBottom: 4
}

const searchStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: '#0a0c10',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 8,
  padding: '8px 12px',
  color: TEXT_FG,
  fontSize: 13,
  outline: 'none'
}

const clearBtnStyle: CSSProperties = {
  background: 'transparent',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 8,
  color: TEXT_DIM,
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 10px',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const miniActionBtn: CSSProperties = {
  ...clearBtnStyle,
  flex: 1,
  textAlign: 'center'
}

const chipRowLabel: CSSProperties = {
  color: TEXT_DIM,
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  margin: '0 0 6px'
}

const chipRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6
}

const chipStyle: CSSProperties = {
  borderStyle: 'solid',
  borderWidth: 1,
  borderRadius: 999,
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const catTitle: CSSProperties = {
  color: TEXT_DIM,
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  margin: '0 0 8px'
}

const featuredHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  borderBottom: `1px solid ${GT3_STROKE}`,
  paddingBottom: 6
}

const featuredTitle: CSSProperties = {
  color: '#FFB000',
  fontSize: 13,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: 0.8
}

const advancedWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginTop: 8,
  borderTop: `1px solid ${GT3_STROKE}`,
  paddingTop: 12
}

const advancedToggle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  background: '#0a0c10',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 10,
  padding: '10px 14px',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%'
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: '#0a0c10',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 10,
  padding: 8,
  cursor: 'pointer',
  textAlign: 'left'
}

const styleBadge: CSSProperties = {
  marginTop: 4,
  alignSelf: 'flex-start',
  color: TEXT_DIM,
  background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 5,
  padding: '1px 6px',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4
}

const hwBadge: CSSProperties = {
  marginTop: 4,
  alignSelf: 'flex-start',
  color: '#D4A000',
  background: 'rgba(212,160,0,0.10)',
  border: '1px solid rgba(212,160,0,0.35)',
  borderRadius: 5,
  padding: '1px 6px',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4
}

const simBadge: CSSProperties = {
  marginTop: 4,
  alignSelf: 'flex-start',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 5,
  padding: '1px 6px',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4
}

const emptyStyle: CSSProperties = {
  color: TEXT_DIM,
  fontSize: 13,
  textAlign: 'center',
  padding: '32px 0'
}

const missingBadge: CSSProperties = {
  marginTop: 6,
  color: '#ffb84d',
  background: 'rgba(255,184,77,0.12)',
  border: '1px solid rgba(255,184,77,0.4)',
  borderRadius: 6,
  padding: '2px 6px',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.2
}
