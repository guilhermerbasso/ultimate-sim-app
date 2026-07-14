// Touch-panel visual-audit grid: renders — via the REAL ButtonBoxRenderer the Windows
// touch window uses — (1) one demo panel per key MATERIAL, (2) the full BUTTON catalog
// tiled into grids, and (3) every ready-made PANEL preset. Each cell is tagged
// [data-tp-id]/[data-tp-cat] so shoot-touchpanels.mjs can screenshot + group them.
// FitText reports non-fitting labels via data-didfit="0", surfaced on window.__tpFit.
import { StrictMode, useEffect, type CSSProperties, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import {
  createButtonBoxPanel,
  KEY_MATERIALS,
  type ButtonAction,
  type ButtonBoxPanel,
  type KeyMaterial
} from '@shared/touch-panel'
import { ALL_TOUCH_BUTTONS } from '@shared/touch-panel-catalog'
import { TOUCH_PANEL_PRESETS } from '@shared/touch-panel-presets'
import { ButtonBoxRenderer } from '@renderer/touchpanel/ButtonBoxRenderer'
import '@renderer/touchpanel/buttonbox.css'
import './gallery.css'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// One showcase panel per material (same 6 keys → easy side-by-side comparison).
function materialDemo(m: KeyMaterial): ButtonBoxPanel {
  return createButtonBoxPanel({
    id: `mat-${m}`,
    name: `Material · ${m}`,
    columns: 3,
    rows: 2,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'FUEL +10', material: m, icon: 'fuel', bodyColor: '#ca8a04', borderColor: '#facc15' },
      { label: 'TEAR OFF', material: m, icon: 'tear-off', bodyColor: '#0891b2', borderColor: '#22d3ee' },
      { label: 'CAM', material: m, icon: 'camera', bodyColor: '#9333ea', borderColor: '#c084fc' },
      { label: 'RADIO', material: m, icon: 'radio', bodyColor: '#16a34a', borderColor: '#4ade80' },
      { label: 'BOX BOX', material: m, bodyColor: '#dc2626', borderColor: '#f87171' },
      { label: '', material: m, icon: 'flag', bodyColor: '#3b82f6', borderColor: '#93c5fd' }
    ]
  })
}

function semanticDemo(): ButtonBoxPanel {
  const none = { kind: 'none' } as const
  const key = (name: string, mode: 'press' | 'hold' = 'press'): ButtonAction => ({ kind: 'keyboard', command: { mode, keys: [name] } })
  return createButtonBoxPanel({
    id: 'semantic-controls',
    name: 'Semantic controls · all kinds / states',
    columns: 4,
    rows: 2,
    gap: 12,
    background: '#05070d',
    buttons: [
      { id: 'sem-momentary', label: 'RADIO', material: 'led_ring', shape: 'round', control: { kind: 'momentary', action: key('V', 'hold') } },
      { id: 'sem-toggle', label: 'LIMITER', material: 'toggle', shape: 'pill', state: { active: true }, activeColor: '#16a34a', activeTextColor: '#ffffff', control: { kind: 'latching-toggle', onAction: key('L'), offAction: key('L') } },
      { id: 'sem-rocker', label: 'TC', material: 'rocker', shape: 'rocker', control: { kind: 'two-position-rocker', negativeAction: key('PageDown'), positiveAction: key('PageUp'), negativeLabel: 'TC down', positiveLabel: 'TC up', repeat: { delayMs: 420, intervalMs: 120 } } },
      { id: 'sem-guard', label: 'IGNITION', material: 'guarded', shape: 'guarded', control: { kind: 'guarded-two-step', action: key('I'), armTimeoutMs: 4000 } },
      { id: 'sem-rotary', label: 'ABS', material: 'rotary', shape: 'rotary', control: { kind: 'rotary', decrementAction: key('['), incrementAction: key(']'), decrementLabel: 'ABS down', incrementLabel: 'ABS up', repeat: { delayMs: 420, intervalMs: 120 } } },
      { id: 'sem-selector', label: 'MAP', material: 'selector', shape: 'rotary', control: { kind: 'selector', initialChoiceId: 'map-1', choices: [{ id: 'map-1', label: 'MAP 1', value: '1', action: key('1') }, { id: 'map-2', label: 'MAP 2', value: '2', action: key('2') }] } },
      { id: 'sem-status', label: 'ENGINE', material: 'led_status', shape: 'status', state: { warning: true }, warningColor: '#b91c1c', control: { kind: 'status-led', value: 'HOT' } },
      { id: 'sem-value', label: 'FUEL', material: 'glass', shape: 'wide', state: { disabled: true }, control: { kind: 'value-tile', value: '52.1', unit: 'L' } }
    ]
  })
}
// The full button catalog, chunked into 5-wide grids.
function catalogPanels(): ButtonBoxPanel[] {
  const per = 10
  const out: ButtonBoxPanel[] = []
  for (let i = 0; i < ALL_TOUCH_BUTTONS.length; i += per) {
    const chunk = ALL_TOUCH_BUTTONS.slice(i, i + per)
    const cols = 5
    const rows = Math.max(1, Math.ceil(chunk.length / cols))
    const n = Math.floor(i / per) + 1
    out.push(
      createButtonBoxPanel({
        id: `cat-${n}`,
        name: `Catálogo ${n}`,
        columns: cols,
        rows,
        gap: 12,
        background: '#05070d',
        buttons: chunk
      })
    )
  }
  return out
}

interface Cell {
  id: string
  name: string
  cat: string
  panel: ButtonBoxPanel
}

function buildCells(filter: string): Cell[] {
  const cells: Cell[] = [{ id: 'semantic-controls', name: 'Semantic controls', cat: 'semantics', panel: semanticDemo() }]
  for (const m of KEY_MATERIALS) cells.push({ id: `mat-${m}`, name: `Material · ${m}`, cat: 'materials', panel: materialDemo(m) })
  for (const p of catalogPanels()) cells.push({ id: p.id, name: p.name, cat: 'catalog', panel: p })
  for (const p of TOUCH_PANEL_PRESETS) {
    const cat = p.id.startsWith('tp-a') ? 'panels-a' : p.id.startsWith('tp-b') ? 'panels-b' : 'panels'
    cells.push({ id: p.id, name: p.name, cat, panel: p })
  }
  if (!filter) return cells
  return cells.filter((c) => `${c.id} ${c.name} ${c.cat}`.toLowerCase().includes(filter))
}

function PanelCell({ cell }: { cell: Cell }): ReactElement {
  const { panel } = cell
  const cols = Math.max(1, panel.columns)
  const rows = Math.max(1, panel.rows)
  const w = clamp(cols * 108, 320, 660)
  const keyH = w / cols
  const h = Math.round(rows * keyH * 0.92)
  const shellStyle: CSSProperties = {
    position: 'relative',
    width: w,
    height: h,
    overflow: 'hidden',
    background: panel.background,
    borderRadius: 8
  }
  return (
    <figure className="va-cell" data-tp-id={cell.id} data-tp-cat={cell.cat} data-tp-name={cell.name}>
      <figcaption className="va-cell-label">
        <span className="va-id">{cell.id}</span>
        <span className="va-title">{cell.name}</span>
      </figcaption>
      <div className="tp-shell" data-tp-shell style={shellStyle}>
        <ButtonBoxRenderer panel={panel} interactive={false} />
      </div>
    </figure>
  )
}

function TouchGrid(): ReactElement {
  const params = new URLSearchParams(window.location.search)
  const filter = (params.get('filter') ?? '').toLowerCase()
  const cells = buildCells(filter)

  useEffect(() => {
    document.title = `Touch Panels · ${cells.length}`
    const t = window.setTimeout(() => {
      // Surface any non-fitting labels (should be zero) for the shooter's lint.
      const bad = Array.from(document.querySelectorAll('[data-fit][data-didfit="0"]'))
      const ids = new Set<string>()
      for (const el of bad) {
        const owner = el.closest('[data-tp-id]')
        if (owner) ids.add(owner.getAttribute('data-tp-id') || '?')
      }
      ;(window as unknown as { __tpFit: string[] }).__tpFit = [...ids]
      document.body.setAttribute('data-va-ready', 'true')
    }, 1100)
    return () => window.clearTimeout(t)
  }, [cells.length])

  return (
    <div className="va-page">
      <header className="va-header">
        <h1>Touch Panels</h1>
        <span className="va-pill">{cells.length} cells</span>
        <span className="va-sub">real ButtonBoxRenderer · {filter ? `filter: ${filter}` : 'materials + catalog + presets'}</span>
      </header>
      <div className="va-grid va-grid-dash">
        {cells.map((c) => (
          <PanelCell key={c.id} cell={c} />
        ))}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <TouchGrid />
  </StrictMode>
)
