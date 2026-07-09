// Preset gallery: real thumbnails generated from the dashboard model
// (wireframe escalado), filtros por tag e "duplicar e editar". Mantida leve —
// draws one rectangle per element (without mounting full widgets).

import { useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Dashboard, DashboardElement, DashboardElementType } from '../../../../shared/dashboards'
import { TagFilter, filterByTags } from '../../components/TagFilter'

const ACCENT = 'var(--accent-primary)'
const GT3_STROKE = '#1F1F1F'
const TEXT_FG = '#f6fbff'
const TEXT_DIM = '#9aa6b2'

export interface PresetEntry {
  id: string
  name: string
  build: () => Dashboard
  tags?: string[]
}

const THUMB_W = 248
const THUMB_H = 140

// Wireframe color by element family.
function elementColor(type: DashboardElementType): string {
  if (type === 'shiftbar' || type === 'shiftlights') return '#FFB000'
  if (type === 'gearcluster') return ACCENT
  if (type === 'tyregrid' || type === 'cornerstack') return '#20e070'
  if (type === 'brakegrid') return '#ff7a4d'
  if (type === 'deltatile' || type === 'deltabar') return '#b66cff'
  if (type === 'flagoverlay' || type === 'flag') return '#ffd400'
  if (type === 'fuelstint') return '#ffb84d'
  if (type === 'standings' || type === 'table') return '#647386'
  if (type === 'text') return 'transparent'
  return '#2b6f66'
}

function elementRadius(el: DashboardElement): number {
  return Math.max(2, Math.min(8, Number(el.style.radius ?? 3)))
}

function MiniOverlayGlyph({ color }: { color: string }): ReactElement {
  return (
    <div style={{ position: 'absolute', inset: 2, borderRadius: 4, border: `1px solid ${color}`, background: '#020304', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, padding: 3 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ height: 3, borderRadius: 1, background: i < 5 ? '#2FFF67' : '#26303d' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: '36%', top: '34%', width: '28%', height: '34%', borderRadius: 3, background: `${color}44` }} />
      <div style={{ position: 'absolute', left: 4, bottom: 4, width: '24%', height: 3, borderRadius: 2, background: '#26303d' }} />
      <div style={{ position: 'absolute', right: 4, bottom: 4, width: '24%', height: 3, borderRadius: 2, background: '#26303d' }} />
    </div>
  )
}

function MiniElementGlyph({ el, color }: { el: DashboardElement; color: string }): ReactElement | null {
  if (el.type === 'overlaywidget') return <MiniOverlayGlyph color={color} />
  if (el.type === 'shiftbar' || el.type === 'shiftlights' || el.type === 'ledbar') {
    return (
      <div style={{ position: 'absolute', left: 3, right: 3, top: '42%', display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1 }}>
        {Array.from({ length: 8 }, (_, i) => <span key={i} style={{ height: 3, borderRadius: 1, background: i < 5 ? color : '#26303d' }} />)}
      </div>
    )
  }
  if (el.type === 'gauge' || el.type === 'valuegauge' || el.type === 'ringgauge' || el.type === 'donut' || el.type === 'analoggauge') {
    return <div style={{ position: 'absolute', inset: 3, borderRadius: 999, border: `2px solid ${color}`, opacity: 0.85 }} />
  }
  if (el.type === 'tyregrid' || el.type === 'brakegrid' || el.type === 'cornerstack' || el.type === 'heatmap' || el.type === 'barchart' || el.type === 'radialbars') {
    return (
      <div style={{ position: 'absolute', inset: 3, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        {[0, 1, 2, 3].map((i) => <span key={i} style={{ borderRadius: 2, background: i % 2 === 0 ? `${color}88` : `${color}44` }} />)}
      </div>
    )
  }
  if (el.type === 'trace' || el.type === 'inputtrace' || el.type === 'historygraph' || el.type === 'deltabar') {
    return (
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: 'absolute', inset: 3, width: 'calc(100% - 6px)', height: 'calc(100% - 6px)' }}>
        <polyline points="0,30 18,22 35,25 55,12 72,18 100,8" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return null
}

function PresetElementBlock({ el }: { el: DashboardElement }): ReactElement {
  const color = elementColor(el.type)
  const visibleColor = color === 'transparent' ? 'rgba(255,255,255,0.30)' : color
  const fill = color === 'transparent' ? 'rgba(255,255,255,0.05)' : `${color}33`
  return (
    <div
      data-preset-thumb-element={el.type}
      style={{
        position: 'absolute',
        left: el.x,
        top: el.y,
        width: Math.max(4, el.w),
        height: Math.max(4, el.h),
        background: fill,
        border: `1px solid ${visibleColor}`,
        borderRadius: elementRadius(el),
        boxShadow: color === 'transparent' ? undefined : `0 0 10px ${color}22`,
        overflow: 'hidden'
      }}
    >
      <MiniElementGlyph el={el} color={visibleColor} />
    </div>
  )
}

// Real preset thumbnail. Elements `overlaywidget` (os dashboards full-frame
// GT3/LMU) and any unknown widget kind now receive a visible wireframe glyph,
// avoiding blank cards when a live renderer needs telemetry or has no mini branch.
function PresetThumb({ dash }: { dash: Dashboard }): ReactElement {
  const safeWidth = Math.max(1, dash.width)
  const safeHeight = Math.max(1, dash.height)
  const scale = Math.min(THUMB_W / safeWidth, THUMB_H / safeHeight)
  const w = safeWidth * scale
  const h = safeHeight * scale
  return (
    <div style={{ width: THUMB_W, height: THUMB_H, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05070a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: safeWidth,
            height: safeHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: dash.bg
          }}
        >
          {dash.elements.map((el) => <PresetElementBlock key={el.id} el={el} />)}
        </div>
      </div>
    </div>
  )
}

function PresetCard({ entry, busy, onPick }: { entry: PresetEntry; busy?: boolean; onPick(id: string): void }): ReactElement {
  const dash = useMemo(() => entry.build(), [entry])
  const isGt3 = entry.tags?.includes('GT3')
  const isAdaptive = entry.tags?.includes('adaptive')
  return (
    <div style={cardStyle}>
      <PresetThumb dash={dash} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {isAdaptive && <span style={adaptiveBadge}>Adaptive</span>}
        {isGt3 && <span style={gt3Badge}>GT3</span>}
        <strong style={{ color: TEXT_FG, fontSize: 13 }}>{entry.name}</strong>
      </div>
      <div style={{ color: TEXT_DIM, fontSize: 11, margin: '2px 0 8px' }}>
        {dash.width}×{dash.height} · {dash.elements.length} elements
      </div>
      {isAdaptive && (
        <div style={{ color: TEXT_DIM, fontSize: 11, margin: '0 0 8px' }}>
          Reorganizes itself live based on the session phase and lap moment.
        </div>
      )}
      {entry.tags && entry.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {entry.tags.map((t) => (
            <span key={t} style={tagChip}>{t}</span>
          ))}
        </div>
      )}
      <button type="button" disabled={busy} onClick={() => onPick(entry.id)} style={pickBtn}>
        Duplicate and edit
      </button>
    </div>
  )
}

export function PresetGallery({
  presets,
  busy,
  onPick
}: {
  presets: PresetEntry[]
  busy?: boolean
  onPick(id: string): void
}): ReactElement {
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const filtered = useMemo(() => filterByTags(presets, selectedTags, (preset) => preset.tags), [presets, selectedTags])
  return (
    <div>
      <TagFilter
        items={presets}
        selectedTags={selectedTags}
        onSelectedTagsChange={setSelectedTags}
        getTags={(preset) => preset.tags}
        style={{ marginBottom: 12 }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(264px, 1fr))', gap: 12 }}>
        {filtered.map((p) => (
          <PresetCard key={p.id} entry={p} busy={busy} onPick={onPick} />
        ))}
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: '#0a0c10',
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 10,
  padding: 8
}

const pickBtn: CSSProperties = {
  marginTop: 'auto',
  background: ACCENT,
  color: '#05070a',
  border: 'none',
  borderRadius: 8,
  padding: '7px 12px',
  fontWeight: 800,
  cursor: 'pointer'
}

const gt3Badge: CSSProperties = {
  background: ACCENT,
  color: '#05070a',
  borderRadius: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.5
}

const adaptiveBadge: CSSProperties = {
  background: '#FF7A00',
  color: '#05070a',
  borderRadius: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0.5,
  textTransform: 'uppercase'
}

const tagChip: CSSProperties = {
  background: '#141b25',
  color: TEXT_DIM,
  border: `1px solid ${GT3_STROKE}`,
  borderRadius: 4,
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 700
}
