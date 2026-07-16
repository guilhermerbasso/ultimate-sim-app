import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { CustomOverlayDef, OverlayGestureState, OverlayPosition, OverlayWidgetConfig, OverlayWidgetId, OverlaysConfig } from '../../../shared/overlays'
import {
  createDefaultOverlayStyle,
  DEFAULT_CUSTOM_OVERLAY_POSITION,
  DEFAULT_OVERLAY_STYLE_PRESET,
  isCustomOverlayId,
  isRichCustomOverlay
} from '../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { ALL_OVERLAY_WIDGETS, createDefaultOverlaysConfigWithHifi, mergeHifiOverlayConfigs, resolveOverlayTrigger, shouldRenderOverlayRuntime } from './hifi-overlays'
import { resolveWidgetComponent } from './widgets'
import { CustomOverlayWidget } from './widgets/CustomOverlayWidget'
import { useOverlayTriggerController } from './useOverlayTriggerController'
import { useAlertsConfig } from '../lib/alerts-config'
import './overlay-runtime.css'

const RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

function getWidgetParam(): string {
  const params = new URLSearchParams(window.location.search)
  const widget = params.get('widget') ?? ''
  if (ALL_OVERLAY_WIDGETS.some((item) => item.id === widget)) return widget
  if (isCustomOverlayId(widget)) return widget
  return 'gearSpeed'
}

function defaultWidgetConfig(id: string): OverlayWidgetConfig {
  if (isCustomOverlayId(id)) {
    return {
      id: id as OverlayWidgetId,
      enabled: true,
      locked: false,
      favorite: false,
      position: { ...DEFAULT_CUSTOM_OVERLAY_POSITION },
      opacity: 100,
      stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
      style: createDefaultOverlayStyle(),
      display: null
    }
  }
  return createDefaultOverlaysConfigWithHifi().widgets[id as OverlayWidgetId]
}

export function OverlayRoot() {
  const widgetId = useMemo(getWidgetParam, [])
  const isCustom = useMemo(() => isCustomOverlayId(widgetId), [widgetId])
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [widgetConfig, setWidgetConfig] = useState<OverlayWidgetConfig & { configMode?: boolean; title?: string }>(() => defaultWidgetConfig(widgetId))
  const definition = ALL_OVERLAY_WIDGETS.find((item) => item.id === widgetId)
  const Widget = isCustom ? CustomOverlayWidget : resolveWidgetComponent(widgetId as OverlayWidgetId)
  const headerTitle = definition?.title ?? widgetConfig.title ?? widgetId
  const configMode = Boolean(widgetConfig.configMode)
  // Rich custom overlays render a full-bleed transparent dashboard canvas (no
  // card chrome), so the shell padding is removed for them.
  const isRich = isCustom && isRichCustomOverlay(widgetConfig as { widgets?: unknown })
  const ResolvedWidget = Widget ?? (() => null)
  // The overlay window receives the mouse when global config mode is on OR this
  // overlay is unlocked — this mirrors manager.updateMouseMode, so a single
  // unlocked overlay becomes editable without toggling the global edit mode.
  const editable = configMode || !widgetConfig.locked
  // A LOCKED overlay never moves/resizes, even inside global config mode ("pinned").
  const movable = !widgetConfig.locked
  const alertsConfig = useAlertsConfig()
  const triggerController = useOverlayTriggerController(snapshot, alertsConfig)
  const overlayTrigger = resolveOverlayTrigger(definition, widgetConfig)
  const triggerState = triggerController.evaluate(widgetId, overlayTrigger)
  const triggerHidden = !shouldRenderOverlayRuntime(definition, widgetConfig, triggerState)
  const positionRef = useRef<OverlayPosition>(widgetConfig.position)
  useEffect(() => {
    positionRef.current = widgetConfig.position
  }, [widgetConfig.position])

  // Mouse-driven move (whole surface) and resize (corner/edge grips). Gesture
  // deltas are calculated in main from Electron's screen cursor point, matching
  // BrowserWindow bounds even on scaled displays.
  const beginGesture = useCallback(
    (event: ReactMouseEvent, mode: 'move' | 'resize', dir: string): void => {
      if (!movable || event.button !== 0) return
      event.preventDefault()
      let started = false
      let active = true
      let latest = { ...positionRef.current }
      let raf = 0
      const requestLiveUpdate = (): void => {
        if (raf || !active || !started) return
        raf = requestAnimationFrame(() => {
          raf = 0
          if (!active || !started) return
          void window.ipc.invoke<OverlayPosition | null>('overlays:setBoundsLiveFromGesture', widgetId)
            .then((position) => {
              if (position) {
                latest = position
                positionRef.current = position
              }
            })
            .catch(() => undefined)
          requestLiveUpdate()
        })
      }
      const onMove = (move: globalThis.MouseEvent): void => {
        move.preventDefault()
        requestLiveUpdate()
      }
      const onUp = (): void => {
        active = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        if (raf) cancelAnimationFrame(raf)
        if (started) {
          void window.ipc.invoke('overlays:finishGesture', widgetId).catch(() => {
            void window.ipc.invoke('overlays:setPosition', widgetId, latest)
          })
        }
      }
      // Attach listeners SYNCHRONOUSLY so a fast mouse-up before the async
      // beginGesture resolves can't leave the window stuck to the cursor.
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      void window.ipc.invoke<OverlayGestureState>('overlays:beginGesture', widgetId, mode, dir)
        .then((nextGesture) => {
          if (!active) {
            // Released before the gesture started — discard it in main.
            void window.ipc.invoke('overlays:finishGesture', widgetId).catch(() => undefined)
            return
          }
          started = true
          latest = nextGesture.basePosition
          positionRef.current = latest
          requestLiveUpdate()
        })
        .catch(() => undefined)
    },
    [movable, widgetId]
  )
  const shellStyle = {
    '--overlay-bg': widgetConfig.style.background,
    '--overlay-accent': widgetConfig.style.accent,
    '--overlay-border': widgetConfig.style.border,
    '--overlay-radius': `${widgetConfig.style.radius}px`,
    '--overlay-font': widgetConfig.style.fontFamily,
    '--overlay-content-opacity': '1'
  } as CSSProperties

  useEffect(() => {
    const custom = isCustomOverlayId(widgetId)
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', setSnapshot)
    const offMode = window.ipc.subscribe<OverlayWidgetConfig & { configMode: boolean }>('overlays:configMode', (payload) => {
      setWidgetConfig((current) => ({ ...current, ...payload }))
    })
    void window.ipc.invoke<TelemetrySnapshot | null>('telemetry:getLatest').then(setSnapshot).catch(() => setSnapshot(null))
    if (custom) {
      void window.ipc.invoke<CustomOverlayDef | null>('overlays:getCustom', widgetId)
        .then((current) => { if (current) setWidgetConfig({ ...current, id: current.id as OverlayWidgetId, configMode: false }) })
        .catch(() => undefined)
    } else {
      void window.ipc.invoke<OverlaysConfig>('overlays:getConfig')
        .then((config) => {
          const merged = mergeHifiOverlayConfigs(config)
          setWidgetConfig({ ...merged.widgets[widgetId as OverlayWidgetId], configMode: merged.configMode })
        })
        .catch(() => undefined)
    }
    return () => {
      offTelemetry()
      offMode()
    }
  }, [widgetId])

  useEffect(() => {
    if (definition?.role !== 'alert') return
    void window.ipc.invoke('overlays:setRuntimeVisibility', widgetId, !triggerHidden).catch(() => undefined)
  }, [definition?.role, triggerHidden, widgetId])

  if (definition?.role === 'alert' && triggerHidden) return null

  return (
    <main
      className={`overlay-shell${configMode ? ' config-mode' : ''}${movable ? ' draggable' : ''}${isRich ? ' rich-overlay' : ''}`}
      style={shellStyle}
      onMouseDown={(event) => beginGesture(event, 'move', '')}
    >
      {editable && (
        <div className={movable ? 'overlay-drag-handle' : 'overlay-drag-handle locked'}>
          {headerTitle}
          {movable ? ' — edit: drag to move — edges resize' : ' · pinned'}
        </div>
      )}
      {!triggerHidden && (
        <ResolvedWidget
          snapshot={snapshot}
          config={widgetConfig}
          visibility={triggerState}
          alertsConfig={alertsConfig}
        />
      )}
      {movable &&
        RESIZE_DIRS.map((dir) => (
          <div
            key={dir}
            className={`overlay-resize ${dir}`}
            onMouseDown={(event) => {
              event.stopPropagation()
              beginGesture(event, 'resize', dir)
            }}
          />
        ))}
      {!snapshot?.connected && <div className="connection-badge">waiting for telemetry</div>}
    </main>
  )
}
