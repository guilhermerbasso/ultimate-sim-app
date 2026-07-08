// Galeria de presets: thumbnails reais gerados a partir do modelo do dashboard
// (wireframe escalado), filtros por tag e "duplicar e editar". Mantida leve —
// desenha um retangulo por elemento (sem montar os widgets completos).

import { useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { Dashboard, DashboardElementType } from '../../../../shared/dashboards'
import { TagFilter, filterByTags } from '../../components/TagFilter'
import { CanvasElementVisual } from './DashboardCanvasEditor'

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

// Color do wireframe por "familia" de elemento.
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

// Thumbnail real do preset. Elementos `overlaywidget` (os dashboards full-frame
// GT3/LMU) sao montados de verdade — escala via `transform` sobre o board em
// tamanho natural — para que a galeria not mostre um retangulo achatado "vazio".
// Os demais elements seguem como wireframe leve (um retangulo por elemento).
function PresetThumb({ dash }: { dash: Dashboard }): ReactElement {
  const scale = Math.min(THUMB_W / dash.width, THUMB_H / dash.height)
  const w = dash.width * scale
  const h = dash.height * scale
  return (
    <div style={{ width: THUMB_W, height: THUMB_H, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05070a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: dash.width,
            height: dash.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: dash.bg
          }}
        >
          {dash.elements.map((el) => {
            if (el.type === 'overlaywidget') {
              return (
                <div
                  key={el.id}
                  style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, overflow: 'hidden' }}
                >
                  <CanvasElementVisual element={el} />
                </div>
              )
            }
            const color = elementColor(el.type)
            return (
              <div
                key={el.id}
                style={{
                  position: 'absolute',
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  background: color === 'transparent' ? 'transparent' : `${color}33`,
                  border: `1px solid ${color === 'transparent' ? 'rgba(255,255,255,0.18)' : color}`,
                  borderRadius: el.style.radius ?? 3
                }}
              />
            )
          })}
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
