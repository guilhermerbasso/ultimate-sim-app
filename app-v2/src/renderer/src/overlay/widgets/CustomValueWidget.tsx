import { useEffect, useMemo, useState } from 'react'
import {
  OUTPUTS_CHANNELS,
  type OutputValueBatch,
  type OutputValueUpdate
} from '../../../../shared/outputs'
import { overlayDesignFamily } from '../../../../shared/overlays'
import type { WidgetProps } from './types'
import './redesign-detail.css'

// Generic overlay slot that surfaces a single routed output value (var) so
// expressions / dashboardVar routes can be displayed without authoring a
// bespoke widget. The configured name can come from:
//   1. (config as any).name — wherever the future config editor stores it
//   2. URL query param `?name=<key>` on the overlay window
//   3. fallback: first available output value in the live snapshot

interface CachedValue {
  name: string
  value: string
  numeric?: number
}

function configuredName(config: WidgetProps['config']): string | undefined {
  const raw = (config as unknown as { name?: unknown }).name
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('name')
    if (fromUrl && fromUrl.trim().length > 0) return fromUrl.trim()
  }
  return undefined
}

function toCached(update: OutputValueUpdate): CachedValue {
  const numeric = typeof update.raw === 'number' && Number.isFinite(update.raw) ? update.raw : undefined
  return { name: update.name, value: update.value, numeric }
}

export function CustomValueWidget({ config }: WidgetProps) {
  const family = overlayDesignFamily(config?.stylePreset)
  const wanted = useMemo(() => configuredName(config), [config])
  const [values, setValues] = useState<Record<string, CachedValue>>({})

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.ipc : undefined
    if (!ipc) return
    let canceled = false

    void ipc
      .invoke<Record<string, OutputValueUpdate>>(OUTPUTS_CHANNELS.getValues)
      .then((snapshot) => {
        if (canceled || !snapshot) return
        const next: Record<string, CachedValue> = {}
        for (const update of Object.values(snapshot)) {
          if (!update || typeof update.name !== 'string' || update.name.length === 0) continue
          next[update.name] = toCached(update)
        }
        setValues((current) => ({ ...current, ...next }))
      })
      .catch(() => undefined)

    const off = ipc.subscribe<OutputValueBatch>(OUTPUTS_CHANNELS.value, (batch) => {
      if (!batch || !Array.isArray(batch.updates) || batch.updates.length === 0) return
      setValues((current) => {
        const next = { ...current }
        for (const update of batch.updates) {
          if (!update || typeof update.name !== 'string' || update.name.length === 0) continue
          next[update.name] = toCached(update)
        }
        return next
      })
    })

    return () => {
      canceled = true
      off()
    }
  }, [])

  const display = useMemo<CachedValue | null>(() => {
    if (wanted && values[wanted]) return values[wanted]
    if (wanted) return null
    const first = Object.values(values)[0]
    return first ?? null
  }, [values, wanted])

  const label = wanted ?? display?.name ?? 'valor'
  const empty = !display
  const emptyMsg = wanted ? `aguardando "${wanted}"` : '— sem métrica —'
  const shown = empty ? emptyMsg : (display?.value ?? '—')
  const valCls = empty ? ' rd2-cv-empty-val' : ''
  const root = `overlay-card rd2-card rd2-fam-${family} rd2-cv rd2-cv-${family}${empty ? ' rd2-cv-is-empty' : ''}`

  if (family === 'terminal') {
    return (
      <div className={root}>
        <pre className="rd2-trm">{`[ ${label.toUpperCase()} ]\n  > ${shown}`}</pre>
      </div>
    )
  }

  if (family === 'bauhaus') {
    return (
      <div className={root}>
        <div className="rd2-cv-bhs">
          <span className="rd2-cv-bhs-label">{label.toUpperCase()}</span>
          <strong className={`rd2-cv-bhs-val${valCls}`}>{shown}</strong>
        </div>
      </div>
    )
  }

  if (family === 'broadcast') {
    return (
      <div className={root}>
        <div className="rd2-cv-bc">
          <span className="rd2-cv-bc-tab">{label.toUpperCase()}</span>
          <strong className={`rd2-cv-bc-val${valCls}`}>{shown}</strong>
        </div>
      </div>
    )
  }

  if (family === 'analog') {
    return (
      <div className={root}>
        <div className="rd2-cv-ang">
          <svg viewBox="0 0 100 100" aria-hidden="true" className="rd2-cv-ang-ring">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(150,140,120,0.25)" strokeWidth="2" />
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--rd2-chrome)" strokeWidth="2" strokeDasharray="2 8" opacity="0.8" />
          </svg>
          <div className="rd2-cv-ang-face">
            <span>{label}</span>
            <strong className={empty ? 'rd2-cv-empty-val' : undefined}>{shown}</strong>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'heatmap') {
    return (
      <div className={root}>
        <div className="rd2-cv-hm">
          <em>{label.toUpperCase()}</em>
          <b className={empty ? 'rd2-cv-empty-val' : undefined}>{shown}</b>
        </div>
      </div>
    )
  }

  if (family === 'neon') {
    return (
      <div className={root}>
        <div className="rd2-cv-neon">
          <span className="rd2-cv-neon-label">{label.toUpperCase()}</span>
          <strong className={`rd2-cv-neon-val${valCls}`}>{shown}</strong>
        </div>
      </div>
    )
  }

  // minimal / glass
  return (
    <div className={root}>
      <div className="rd2-cv-min">
        <span className="rd2-cv-min-label">{label}</span>
        <strong className={`rd2-cv-min-val${valCls}`}>{shown}</strong>
      </div>
    </div>
  )
}
