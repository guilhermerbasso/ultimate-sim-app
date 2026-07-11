// Preset gallery: real thumbnails generated from the dashboard model.

import { Component, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react'
import type { Dashboard, DashboardPreset } from '../../../../shared/dashboards'
import { DEFAULT_DASHBOARD_PRESET_PRIORITY, sortElementsByZ } from '../../../../shared/dashboards'
import { renderDashboardElement } from '../../dashboard/DashboardRoot'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import { TagFilter, filterByTags } from '../../components/TagFilter'
import '../../overlay/overlay-view.css'

const ACCENT = 'var(--accent-primary)'
const GT3_STROKE = '#1F1F1F'
const TEXT_FG = '#f6fbff'
const TEXT_DIM = '#9aa6b2'

export type PresetEntry = DashboardPreset

const THUMB_W = 248
const THUMB_H = 140

function presetPriority(entry: PresetEntry): number {
  return Number.isFinite(entry.priority) ? entry.priority as number : DEFAULT_DASHBOARD_PRESET_PRIORITY
}

class PresetThumbBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    // Keep a bad preset/widget from crashing the full gallery.
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: TEXT_DIM, fontSize: 12 }}>Preview unavailable</div>
    }
    return this.props.children
  }
}

function usePreviewVisible(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])
  return [ref, visible]
}

function PresetThumb({ dash }: { dash: Dashboard }): ReactElement {
  const safeWidth = Math.max(1, dash.width)
  const safeHeight = Math.max(1, dash.height)
  const scale = Math.min(THUMB_W / safeWidth, THUMB_H / safeHeight)
  const w = safeWidth * scale
  const h = safeHeight * scale
  const sorted = useMemo(() => sortElementsByZ(dash.elements), [dash.elements])
  const [ref, visible] = usePreviewVisible()
  return (
    <div ref={ref} style={{ width: THUMB_W, height: THUMB_H, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05070a', borderRadius: 8, overflow: 'hidden' }}>
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
            background: dash.bg,
            pointerEvents: 'none'
          }}
        >
          {visible && (
            <PresetThumbBoundary>
              {sorted
                .filter((element) => element.visible !== false)
                .map((element) => (
                  <Fragment key={element.id}>
                    {renderDashboardElement({ element, snapshot: PREVIEW_SNAPSHOT, preview: 'inert' })}
                  </Fragment>
                ))}
            </PresetThumbBoundary>
          )}
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
  const orderedPresets = useMemo(
    () => presets
      .map((preset, index) => ({ preset, index }))
      .sort((a, b) => presetPriority(a.preset) - presetPriority(b.preset) || a.index - b.index)
      .map(({ preset }) => preset),
    [presets]
  )
  const filtered = useMemo(() => filterByTags(orderedPresets, selectedTags, (preset) => preset.tags), [orderedPresets, selectedTags])
  return (
    <div>
      <TagFilter
        items={orderedPresets}
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
