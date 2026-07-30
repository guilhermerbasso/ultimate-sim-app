import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { evaluateExpression, flattenExpressionScope } from '../../../../shared/expr-eval'
import { buildIracingExpressionScope } from '../../../../shared/iracing-vars'
import {
  EXPR_CHANNELS,
  type EnabledIracingVars,
  type ExpressionDef,
  type ExpressionValue
} from '../../../../shared/expr'
import type { ExpressionDestinationPlacement } from '../../../../shared/expression-studio'
import type { ExpressionStudioSnapshot } from '../../../../shared/expression-studio'
import type { DashboardElement } from '../../../../shared/dashboards'
import { isCustomOverlayId, isRichCustomOverlay, type CustomOverlayDef } from '../../../../shared/overlays'
import type { WidgetProps } from './types'
import { RichOverlayCanvas } from '../RichOverlayCanvas'

// Generic renderer for user-built custom overlays (see shared/overlays.ts:
// CustomOverlayDef). Each element binds to a saved Expression OR a raw iRacing
// telemetry channel and is evaluated LIVE against the current TelemetrySnapshot,
// reusing the exact same scope builders + engine the Expressions menu uses (no
// engine is re-implemented). The overlay preload allowlists both `overlays:` and
// `expr:` channels, so this widget can pull the def and the expression catalog
// without any preload change.

// Raw telemetry channel bindings are encoded in CustomOverlayElement.expressionId
// as `channel:<VarId>` (kept in sync with OverlaysView). The element formula then
// holds the bare var id (e.g. `Speed`), which resolves against the scope below.
const CHANNEL_BINDING_PREFIX = 'channel:'

function channelVarIdFromBinding(expressionId: string): string | null {
  return expressionId.startsWith(CHANNEL_BINDING_PREFIX) ? expressionId.slice(CHANNEL_BINDING_PREFIX.length) : null
}

function customOverlayIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const widget = new URLSearchParams(window.location.search).get('widget')
  return isCustomOverlayId(widget) ? widget : null
}

function trimNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function formatValue(value: ExpressionValue, decimals: number | null, suffix: string): string {
  if (value === null || value === undefined) return '—'
  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    text = decimals === null ? trimNumber(value) : value.toFixed(decimals)
  } else if (typeof value === 'boolean') {
    text = value ? 'yes' : 'no'
  } else {
    text = value
  }
  return suffix ? `${text}${suffix}` : text
}

export function CustomOverlayWidget({ snapshot }: WidgetProps) {
  const overlayId = useMemo(customOverlayIdFromUrl, [])
  const [def, setDef] = useState<CustomOverlayDef | null>(null)
  const [expressions, setExpressions] = useState<Record<string, ExpressionDef>>({})
  const [enabledVars, setEnabledVars] = useState<EnabledIracingVars>([])
  const [expressionPlacements, setExpressionPlacements] = useState<DashboardElement[]>([])

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.ipc : undefined
    if (!ipc || !overlayId) return
    let canceled = false

    void ipc
      .invoke<CustomOverlayDef | null>('overlays:getCustom', overlayId)
      .then((value) => {
        if (!canceled && value) setDef(value)
      })
      .catch(() => undefined)

    void ipc
      .invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions)
      .then((items) => {
        if (canceled || !Array.isArray(items)) return
        setExpressions(Object.fromEntries(items.map((item) => [item.id, item])))
      })
      .catch(() => undefined)

    void ipc
      .invoke<EnabledIracingVars>(EXPR_CHANNELS.getEnabledVars)
      .then((items) => {
        if (!canceled && Array.isArray(items)) setEnabledVars(items)
      })
      .catch(() => undefined)

    // Live def updates pushed by the manager when the designer saves changes.
    const offDef = ipc.subscribe<CustomOverlayDef>('overlays:customDef', (payload) => {
      if (payload && payload.id === overlayId) setDef(payload)
    })
    const offStudio = ipc.subscribe<ExpressionStudioSnapshot>(EXPR_CHANNELS.studioChanged, (snapshot) => {
      if (!snapshot || !Array.isArray(snapshot.expressions) || !Array.isArray(snapshot.enabledVars)) return
      setExpressions(Object.fromEntries(snapshot.expressions.map((item) => [item.id, item])))
      setEnabledVars(snapshot.enabledVars)
    })

    return () => {
      canceled = true
      offDef()
      offStudio()
    }
  }, [overlayId])

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.ipc : undefined
    if (!ipc || !overlayId) return
    let canceled = false
    const refresh = (): void => {
      void ipc
        .invoke<ExpressionDestinationPlacement[]>(EXPR_CHANNELS.getPlacements, {
          surface: 'overlay',
          targetId: overlayId
        })
        .then((placements) => {
          if (!canceled) setExpressionPlacements((placements ?? []).map((item) => item.element))
        })
        .catch(() => {
          if (!canceled) setExpressionPlacements([])
        })
    }
    refresh()
    const off = ipc.subscribe(EXPR_CHANNELS.studioChanged, refresh)
    const offDef = ipc.subscribe<CustomOverlayDef>('overlays:customDef', (next) => {
      if (next?.id === overlayId) refresh()
    })
    return () => {
      canceled = true
      off()
      offDef()
    }
  }, [overlayId])

  // Raw-channel bindings (`channel:<VarId>`) need their var id present in scope so
  // the trivial formula resolves — add them on top of the user's enabled vars so a
  // channel can be dropped on an overlay WITHOUT first enabling it in Expressions.
  const channelVarIds = useMemo(() => {
    if (!def) return [] as string[]
    const ids = new Set<string>()
    for (const element of def.elements) {
      const channelVarId = channelVarIdFromBinding(element.expressionId)
      if (channelVarId) ids.add(channelVarId)
    }
    return [...ids]
  }, [def])

  const scope = useMemo(
    () => ({
      ...flattenExpressionScope(snapshot),
      ...buildIracingExpressionScope(snapshot, [...enabledVars, ...channelVarIds])
    }),
    [snapshot, enabledVars, channelVarIds]
  )

  const rendered = useMemo(() => {
    if (!def) return []
    return def.elements.map((element) => {
      const formula = (expressions[element.expressionId]?.expr ?? element.expression).trim()
      let value: ExpressionValue = null
      if (formula) {
        try {
          value = evaluateExpression(formula, scope)
        } catch {
          // Per-frame eval errors (missing telemetry, type mismatch) are common —
          // keep the overlay alive and just show a placeholder for this element.
          value = null
        }
      }
      return { element, text: formatValue(value, element.decimals, element.suffix), hasExpr: Boolean(formula) }
    })
  }, [def, expressions, scope])

  if (!overlayId) {
    return <div className="overlay-card custom-overlay custom-overlay-empty">invalid overlay</div>
  }

  // RICH overlays render the dashboard widget set with the shared dashboard
  // renderer over a transparent canvas (no card chrome). Legacy overlays keep
  // the expression/channel text-card rendering below.
  if (def && isRichCustomOverlay(def)) {
    const placementIds = new Set(expressionPlacements.map((element) => element.id))
    const widgets = [...(def.widgets ?? []).filter((element) => !placementIds.has(element.id)), ...expressionPlacements]
    return (
      <RichOverlayCanvas
        widgets={widgets}
        canvasWidth={def.canvasWidth ?? def.position.width}
        canvasHeight={def.canvasHeight ?? def.position.height}
        snapshot={snapshot}
        scaleMode="stretch"
      />
    )
  }

  return (
    <div className="overlay-card custom-overlay">
      {(!def || def.elements.length === 0) && (
        <div className="custom-overlay-placeholder">
          {def ? 'No elements → edit in the Overlays menu' : 'loading?'}
        </div>
      )}
      {rendered.map(({ element, text, hasExpr }) => {
        const containerStyle: CSSProperties = {
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          fontSize: element.fontSize,
          textAlign: element.align,
          alignItems: element.align === 'center' ? 'center' : element.align === 'right' ? 'flex-end' : 'flex-start'
        }
        const valueStyle: CSSProperties = element.color ? { color: element.color } : {}
        return (
          <div key={element.id} className="custom-overlay-element" style={containerStyle}>
            {element.label && <span className="custom-overlay-label">{element.label}</span>}
            <span className="custom-overlay-value" style={valueStyle}>
              {hasExpr ? text : '—'}
            </span>
          </div>
        )
      })}
      {def && expressionPlacements.length > 0 && (
        <RichOverlayCanvas
          widgets={expressionPlacements}
          canvasWidth={def.canvasWidth ?? def.position.width}
          canvasHeight={def.canvasHeight ?? def.position.height}
          snapshot={snapshot}
          scaleMode="stretch"
        />
      )}
    </div>
  )
}
