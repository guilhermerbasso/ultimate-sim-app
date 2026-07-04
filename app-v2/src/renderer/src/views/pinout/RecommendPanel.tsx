import { type CSSProperties, type ReactElement, useMemo, useState } from 'react'
import {
  recommendBuild,
  type BoardArchitecturePlan,
  type BuildRecommendation,
  type BuildRequirement,
  type MergedCatalog,
  type PinoutComponentCategory,
  type PinoutComponentDefinition,
  type RecommendedExpander,
  type RecommendSelection
} from '../../../../shared/board-catalog'

type ToastTone = 'success' | 'error' | 'info'

interface RecommendPanelProps {
  catalog: MergedCatalog
  onApply(plan: BoardArchitecturePlan, selections: RecommendSelection[]): void
  showToast(message: string, tone?: ToastTone): void
}

type CategoryFilter = PinoutComponentCategory | 'All'

const PICKER_CATEGORIES: PinoutComponentCategory[] = ['Lights', 'Screens', 'Sound', 'Haptics', 'Inputs', 'Sensors', 'Motors', 'Power', 'Comms', 'Custom']
const CATEGORY_FILTERS: CategoryFilter[] = ['All', ...PICKER_CATEGORIES]

// Components the builder picks are the desired *end* parts. Expander/mux chips are
// what the recommender adds for them, so they are intentionally excluded here.
function isPickable(definition: PinoutComponentDefinition): boolean {
  return definition.type !== 'expander' && definition.type !== 'multiplexer'
}

export function RecommendPanel({ catalog, onApply, showToast }: RecommendPanelProps): ReactElement {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All')
  const [searchText, setSearchText] = useState('')
  const [recommendation, setRecommendation] = useState<BuildRecommendation | null>(null)

  const pickable = useMemo(() => catalog.components.filter(isPickable), [catalog.components])
  const selections = useMemo<RecommendSelection[]>(
    () => Object.entries(quantities).filter(([, qty]) => qty > 0).map(([componentId, qty]) => ({ componentId, qty })),
    [quantities]
  )
  const totalParts = selections.reduce((sum, item) => sum + item.qty, 0)

  const normalizedSearch = searchText.trim().toLowerCase()
  const filtered = pickable.filter((definition) => {
    const categoryMatches = categoryFilter === 'All' || definition.category === categoryFilter
    const textMatches = !normalizedSearch || [
      definition.name,
      definition.shortName,
      definition.description,
      definition.plainLanguageDescription,
      definition.category,
      ...definition.roles.map((role) => `${role.label} ${role.kind}`)
    ].join(' ').toLowerCase().includes(normalizedSearch)
    return categoryMatches && textMatches
  })
  const visibleCategories = PICKER_CATEGORIES.filter((category) => filtered.some((definition) => definition.category === category))

  function setQty(componentId: string, qty: number): void {
    setQuantities((current) => {
      const next = { ...current }
      const safe = Math.max(0, Math.min(999, Math.round(qty)))
      if (safe <= 0) delete next[componentId]
      else next[componentId] = safe
      return next
    })
  }

  function clearAll(): void {
    setQuantities({})
    setRecommendation(null)
  }

  function runRecommendation(): void {
    const result = recommendBuild(selections, catalog)
    setRecommendation(result)
    if (!result.ok) showToast(result.summary, 'info')
    else showToast(`Recommended: ${result.chosen?.boardName ?? 'a board'}.`, 'success')
  }

  function applyPlan(plan: BoardArchitecturePlan): void {
    onApply(plan, selections)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(520px, 1fr) 420px', gap: 16 }}>
      <section style={panelStyle}>
        <h3 style={sectionTitle}>Pick the parts you want — we recommend the board</h3>
        <p style={hintStyle}>Reverse flow: choose your buttons, encoders, pots, LEDs and screens with quantities, then let the designer pick the simplest board and tell you whether (and how many) multiplexers or I/O expanders you need, and why. Expander chips are added for you on “Apply”.</p>
        <div style={filterPanelStyle}>
          <label style={fieldLabel}>Search parts<input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Try “button”, “pot”, “encoder”, “LED”, “screen”…" style={inputStyle} /></label>
          <div style={badgeRow} aria-label="Category filters">{CATEGORY_FILTERS.map((category) => {
            const active = categoryFilter === category
            const count = category === 'All' ? pickable.length : pickable.filter((definition) => definition.category === category).length
            if (count === 0 && category !== 'All') return null
            return <button key={category} type="button" onClick={() => setCategoryFilter(category)} style={{ ...filterChipButton, borderColor: active ? 'var(--accent-primary)' : 'rgba(148,163,184,.24)', color: active ? '#e0f2fe' : '#bfdbfe', background: active ? 'rgba(14,165,233,.22)' : 'rgba(15,23,42,.78)' }}>{category} <small>{count}</small></button>
          })}</div>
        </div>
        <div style={{ display: 'grid', gap: 16 }}>
          {visibleCategories.length === 0 ? <p style={hintStyle}>No parts match this filter.</p> : visibleCategories.map((category) => (
            <div key={category}>
              <h4 style={{ margin: '8px 0' }}>{category}</h4>
              <div style={pickerGrid}>{filtered.filter((definition) => definition.category === category).map((definition) => (
                <PartRow key={definition.id} definition={definition} qty={quantities[definition.id] ?? 0} onQty={(qty) => setQty(definition.id, qty)} />
              ))}</div>
            </div>
          ))}
        </div>
      </section>

      <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <section style={panelStyle}>
          <h3 style={sectionTitle}>Your parts</h3>
          {selections.length === 0 ? <p style={hintStyle}>Nothing selected yet. Add quantities on the left.</p> : (
            <div style={{ display: 'grid', gap: 6 }}>
              {selections.map((item) => {
                const definition = catalog.componentsById[item.componentId]
                return <div key={item.componentId} style={selectedRowStyle}><span style={{ fontSize: 18 }}>{definition?.icon ?? '□'}</span><span style={{ flex: 1 }}>{definition?.shortName ?? item.componentId}</span><b>× {item.qty}</b></div>
              })}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <button type="button" style={secondaryButton} disabled={selections.length === 0} onClick={clearAll}>Clear</button>
            <button type="button" style={primaryButton} disabled={selections.length === 0} onClick={runRecommendation}>Recommend board{totalParts > 0 ? ` (${totalParts})` : ''}</button>
          </div>
        </section>

        {recommendation && !recommendation.ok && (
          <section style={panelStyle}>
            <p style={{ ...hintStyle, color: '#fca5a5' }}>{recommendation.summary}</p>
            {recommendation.unmetReasons.length > 0 && <ul style={reasonListStyle}>{recommendation.unmetReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
          </section>
        )}

        {recommendation?.ok && recommendation.chosen && (
          <>
            <RequirementChips requirement={recommendation.requirement} />
            <PlanCard plan={recommendation.chosen} primary onApply={() => applyPlan(recommendation.chosen as BoardArchitecturePlan)} />
            {recommendation.alternatives.length > 0 && (
              <section style={panelStyle}>
                <h4 style={{ margin: '0 0 8px' }}>Alternatives</h4>
                <div style={{ display: 'grid', gap: 10 }}>{recommendation.alternatives.map((plan) => <PlanCard key={plan.boardId} plan={plan} onApply={() => applyPlan(plan)} />)}</div>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

function PartRow({ definition, qty, onQty }: { definition: PinoutComponentDefinition; qty: number; onQty(qty: number): void }): ReactElement {
  return (
    <div style={{ ...partRowStyle, borderColor: qty > 0 ? 'var(--accent-primary)' : 'rgba(148,163,184,.24)' }} title={definition.description}>
      <span style={{ fontSize: 22 }}>{definition.icon}</span>
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{definition.shortName}</b>
        <small style={hintStyle}>{definition.plainLanguageDescription}</small>
      </span>
      <span style={stepperStyle}>
        <button type="button" style={stepButtonSmall} onClick={() => onQty(qty - 1)} aria-label={`Remove one ${definition.shortName}`}>−</button>
        <input value={qty} onChange={(event) => onQty(Number(event.target.value) || 0)} inputMode="numeric" style={qtyInputStyle} aria-label={`${definition.shortName} quantity`} />
        <button type="button" style={stepButtonSmall} onClick={() => onQty(qty + 1)} aria-label={`Add one ${definition.shortName}`}>+</button>
      </span>
    </div>
  )
}

function RequirementChips({ requirement }: { requirement: BuildRequirement }): ReactElement {
  const chips: Array<{ label: string; color: string }> = []
  if (requirement.digitalIn) chips.push({ label: `${requirement.digitalIn} digital in`, color: '#60a5fa' })
  if (requirement.digitalOut) chips.push({ label: `${requirement.digitalOut} digital out`, color: '#60a5fa' })
  if (requirement.analogIn || requirement.analogDirect) chips.push({ label: `${requirement.analogIn + requirement.analogDirect} analog`, color: '#34d399' })
  if (requirement.pwm) chips.push({ label: `${requirement.pwm} PWM`, color: '#f59e0b' })
  if (requirement.directDigital) chips.push({ label: `${requirement.directDigital} direct line`, color: '#93c5fd' })
  if (requirement.i2cDevices) chips.push({ label: `${requirement.i2cDevices} I2C`, color: '#a78bfa' })
  if (requirement.spiDevices) chips.push({ label: `${requirement.spiDevices} SPI`, color: '#c084fc' })
  if (requirement.uartDevices) chips.push({ label: `${requirement.uartDevices} UART`, color: '#f472b6' })
  if (requirement.needsUsbHid) chips.push({ label: 'USB HID', color: '#22d3ee' })
  return (
    <section style={panelStyle}>
      <h4 style={{ margin: '0 0 8px' }}>Required resources</h4>
      <div style={badgeRow}>{chips.length === 0 ? <small style={hintStyle}>Power / documentation only.</small> : chips.map((chip) => <span key={chip.label} style={{ ...chipStyle, borderColor: chip.color, color: chip.color }}>{chip.label}</span>)}</div>
    </section>
  )
}

function PlanCard({ plan, primary, onApply }: { plan: BoardArchitecturePlan; primary?: boolean; onApply(): void }): ReactElement {
  const fitColor = plan.directFit ? '#86efac' : '#fde68a'
  const fitLabel = plan.directFit ? 'Direct fit · no extra chips' : `${plan.extraChips} expander chip(s)`
  return (
    <section style={{ ...planCardStyle, borderColor: primary ? 'var(--accent-primary)' : 'rgba(148,163,184,.24)', background: primary ? 'rgba(14,165,233,.10)' : 'rgba(2,6,23,.42)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: primary ? 16 : 14 }}>{primary ? '★ ' : ''}{plan.boardName}</strong>
        <span style={{ ...chipStyle, borderColor: fitColor, color: fitColor, fontSize: 11 }}>{fitLabel}</span>
      </div>
      <PinBudgetBars plan={plan} />
      {plan.expanders.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>{plan.expanders.map((expander) => <ExpanderLine key={`${expander.definitionId}-${expander.sigMode ?? ''}`} expander={expander} />)}</div>
      )}
      <ul style={reasonListStyle}>{plan.rationale.map((line, index) => <li key={index}>{line}</li>)}</ul>
      {plan.warnings.length > 0 && <ul style={{ ...reasonListStyle, color: '#fde68a' }}>{plan.warnings.map((line, index) => <li key={index}>⚠ {line}</li>)}</ul>}
      <button type="button" style={primary ? primaryButton : secondaryButton} onClick={onApply}>Apply this build</button>
    </section>
  )
}

function ExpanderLine({ expander }: { expander: RecommendedExpander }): ReactElement {
  return (
    <div style={expanderLineStyle}>
      <b style={{ color: '#5eead4' }}>{expander.count}× {expander.name}</b>
      {expander.sigMode && <span style={{ ...chipStyle, fontSize: 10, borderColor: '#5eead4', color: '#5eead4' }}>{expander.sigMode}</span>}
      <small style={hintStyle}>{expander.purpose}</small>
    </div>
  )
}

function PinBudgetBars({ plan }: { plan: BoardArchitecturePlan }): ReactElement {
  const budget = plan.pinBudget
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Bar label="Signal pins" used={budget.signalPinsUsed} available={budget.signalPinsAvailable} color="var(--accent-primary)" />
      {budget.digitalAvailable > 0 && <Bar label="Digital" used={budget.digitalUsed} available={budget.digitalAvailable} color="#60a5fa" />}
      {budget.analogAvailable > 0 && <Bar label="Analog" used={budget.analogUsed} available={budget.analogAvailable} color="#34d399" />}
      {budget.pwmAvailable > 0 && budget.pwmUsed > 0 && <Bar label="PWM" used={budget.pwmUsed} available={budget.pwmAvailable} color="#f59e0b" />}
    </div>
  )
}

function Bar({ label, used, available, color }: { label: string; used: number; available: number; color: string }): ReactElement {
  const pct = available > 0 ? Math.min(100, Math.round((used / available) * 100)) : 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr 48px', gap: 8, alignItems: 'center' }}>
      <small style={hintStyle}>{label}</small>
      <span style={barTrackStyle}><span style={{ ...barFillStyle, width: `${pct}%`, background: color }} /></span>
      <small style={hintStyle}>{used}/{available}</small>
    </div>
  )
}

const panelStyle: CSSProperties = { border: '1px solid rgba(148,163,184,.22)', borderRadius: 'var(--radius-sm)', background: 'rgba(15, 23, 42, 0.72)', padding: 14 }
const hintStyle: CSSProperties = { color: '#9ca3af', fontSize: 12, lineHeight: 1.45 }
const sectionTitle: CSSProperties = { margin: '0 0 8px' }
const inputStyle: CSSProperties = { width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(148,163,184,.35)', background: 'var(--surface-sunken)', color: '#e5eefc', padding: '10px 12px' }
const primaryButton: CSSProperties = { ...inputStyle, marginTop: 4, background: 'var(--accent-primary)', borderColor: 'var(--border-strong)', cursor: 'pointer', fontWeight: 700, width: '100%' }
const secondaryButton: CSSProperties = { ...inputStyle, marginTop: 4, background: 'rgba(30,41,59,.78)', cursor: 'pointer', width: '100%' }
const badgeRow: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' }
const chipStyle: CSSProperties = { display: 'inline-flex', gap: 6, alignItems: 'center', border: '1px solid rgba(148,163,184,.24)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', fontSize: 12 }
const filterPanelStyle: CSSProperties = { display: 'grid', gap: 10, border: '1px solid rgba(56,189,248,.24)', borderRadius: 'var(--radius-sm)', padding: 12, background: 'var(--surface-base)', margin: '12px 0 16px' }
const filterChipButton: CSSProperties = { border: '1px solid', borderRadius: 'var(--radius-sm)', padding: '6px 9px', cursor: 'pointer', fontWeight: 700 }
const fieldLabel: CSSProperties = { display: 'grid', gap: 6, color: '#bfdbfe', fontSize: 12 }
const pickerGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }
const partRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 8, alignItems: 'center', border: '1px solid rgba(148,163,184,.24)', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)', padding: 9 }
const stepperStyle: CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center' }
const stepButtonSmall: CSSProperties = { width: 30, height: 32, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(148,163,184,.35)', background: 'rgba(30,41,59,.85)', color: '#e5eefc', cursor: 'pointer', fontWeight: 700, fontSize: 16, lineHeight: 1 }
const qtyInputStyle: CSSProperties = { width: 44, textAlign: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(148,163,184,.35)', background: 'var(--surface-sunken)', color: '#e5eefc', padding: '7px 4px' }
const selectedRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', border: '1px solid rgba(148,163,184,.18)', borderRadius: 'var(--radius-sm)', padding: '6px 9px' }
const planCardStyle: CSSProperties = { display: 'grid', gap: 8, border: '1px solid', borderRadius: 'var(--radius-sm)', padding: 12 }
const reasonListStyle: CSSProperties = { margin: '2px 0 0', paddingLeft: 18, color: '#cbd5f5', fontSize: 12, lineHeight: 1.5, display: 'grid', gap: 3 }
const expanderLineStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', border: '1px solid rgba(20,184,166,.28)', borderRadius: 'var(--radius-sm)', padding: '6px 9px', background: 'rgba(13,148,136,.08)' }
const barTrackStyle: CSSProperties = { display: 'block', height: 7, borderRadius: 'var(--radius-sm)', background: 'rgba(15,23,42,.95)', border: '1px solid rgba(148,163,184,.22)', overflow: 'hidden' }
const barFillStyle: CSSProperties = { display: 'block', height: '100%', transition: 'width .2s ease' }
