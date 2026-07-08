import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type {
  OverlayGestureState,
  OverlayListItem,
  OverlayPosition,
  OverlayWidgetConfig,
  OverlayWidgetId,
  OverlaysConfig
} from '../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { ALL_OVERLAY_WIDGETS, createDefaultOverlaysConfigWithHifi, HIFI_DEFAULT_TRIGGERS, mergeHifiOverlayConfigs } from './hifi-overlays'
import { evaluateOverlayTrigger } from '../../../shared/overlays'
import { resolveWidgetComponent } from './widgets'
import './overlay-runtime.css'

const RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

interface CompositorDisplay {
  id: number
  x: number
  y: number
  width: number
  height: number
}

function displayFromUrl(): CompositorDisplay {
  const params = new URLSearchParams(window.location.search)
  const num = (name: string, fallback: number): number => {
    const value = Number(params.get(name))
    return Number.isFinite(value) ? value : fallback
  }
  return {
    id: num('displayId', 0),
    x: num('displayX', 0),
    y: num('displayY', 0),
    width: num('displayWidth', window.innerWidth),
    height: num('displayHeight', window.innerHeight)
  }
}

function overlapsDisplay(position: OverlayPosition, display: CompositorDisplay): boolean {
  return (
    position.x < display.x + display.width &&
    position.x + position.width > display.x &&
    position.y < display.y + display.height &&
    position.y + position.height > display.y
  )
}

function configFromItems(items: OverlayListItem[], current: OverlaysConfig): OverlaysConfig {
  return {
    ...current,
    widgets: {
      ...current.widgets,
      ...Object.fromEntries(items.map((item) => [item.id, {
        id: item.id,
        enabled: item.enabled,
        locked: item.locked,
        favorite: item.favorite,
        position: item.position,
        opacity: item.opacity,
        stylePreset: item.stylePreset,
        style: item.style,
        display: item.display
      }]))
    } as OverlaysConfig['widgets']
  }
}

function shellStyle(config: OverlayWidgetConfig): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    '--overlay-bg': config.style.background,
    '--overlay-accent': config.style.accent,
    '--overlay-border': config.style.border,
    '--overlay-radius': `${config.style.radius}px`,
    '--overlay-font': config.style.fontFamily,
    '--overlay-content-opacity': '1'
  } as CSSProperties
}

export function CompositorRoot() {
  const display = useMemo(displayFromUrl, [])
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [config, setConfig] = useState<OverlaysConfig>(createDefaultOverlaysConfigWithHifi())
  const configRef = useRef(config)
  const lastHitRef = useRef<boolean | null>(null)
  const hitHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    configRef.current = config
  }, [config])

  const enabledLayers = useMemo(() => {
    return ALL_OVERLAY_WIDGETS
      .map((definition) => {
        const widgetConfig = config.widgets[definition.id]
        // Skip user-hidden overlays (moved to the "Hidden" section) entirely.
        return widgetConfig?.enabled && !widgetConfig.hidden ? { definition, config: widgetConfig } : null
      })
      .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer))
      .filter((layer) => overlapsDisplay(layer.config.position, display))
  }, [config.widgets, display])

  // Spotter-style trigger-only overlays: an overlay whose trigger is set (and not
  // 'always') is only painted while its condition fires against live telemetry.
  // Falls back to the module's defaultTrigger when the user has not set one.
  const isTriggered = useCallback((layerConfig: OverlayWidgetConfig): boolean => {
    const trigger = layerConfig.trigger ?? HIFI_DEFAULT_TRIGGERS[layerConfig.id] ?? null
    return evaluateOverlayTrigger(trigger, snapshot)
  }, [snapshot])

  const reportHit = useCallback((interactive: boolean): void => {
    const sendHit = (): void => {
      void window.ipc.invoke('overlays:compositorHit', { displayId: display.id, interactive }).catch(() => undefined)
    }
    if (!interactive) {
      if (hitHeartbeatRef.current) {
        clearInterval(hitHeartbeatRef.current)
        hitHeartbeatRef.current = null
      }
      lastHitRef.current = false
      sendHit()
      return
    }
    if (!hitHeartbeatRef.current) {
      hitHeartbeatRef.current = setInterval(sendHit, 250)
    }
    if (lastHitRef.current === interactive) return
    lastHitRef.current = interactive
    sendHit()
  }, [display.id])

  const hitTest = useCallback((clientX: number, clientY: number): boolean => {
    const screenX = display.x + clientX
    const screenY = display.y + clientY
    for (let index = enabledLayers.length - 1; index >= 0; index -= 1) {
      const layer = enabledLayers[index]
      const { position } = layer.config
      const inside = screenX >= position.x && screenX <= position.x + position.width &&
        screenY >= position.y && screenY <= position.y + position.height
      if (inside) return !layer.config.locked
    }
    return false
  }, [display.x, display.y, enabledLayers])

  const beginGesture = useCallback(
    (event: ReactMouseEvent, id: OverlayWidgetId, mode: 'move' | 'resize', dir: string): void => {
      const widgetConfig = configRef.current.widgets[id]
      if (!widgetConfig || widgetConfig.locked || event.button !== 0) return
      event.preventDefault()
      let started = false
      let active = true
      let raf = 0
      const applyPosition = (position: OverlayPosition): void => {
        setConfig((current) => ({
          ...current,
          widgets: {
            ...current.widgets,
            [id]: { ...current.widgets[id], position }
          }
        }))
      }
      const requestLiveUpdate = (): void => {
        if (raf || !active || !started) return
        raf = requestAnimationFrame(() => {
          raf = 0
          if (!active || !started) return
          void window.ipc.invoke<OverlayPosition | null>('overlays:setBoundsLiveFromGesture', id)
            .then((position) => {
              if (position) applyPosition(position)
            })
            .catch(() => undefined)
          requestLiveUpdate()
        })
      }
      const onMove = (move: globalThis.MouseEvent): void => {
        move.preventDefault()
        reportHit(hitTest(move.clientX, move.clientY))
        requestLiveUpdate()
      }
      const onUp = (): void => {
        active = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        if (raf) cancelAnimationFrame(raf)
        if (started) void window.ipc.invoke('overlays:finishGesture', id).catch(() => undefined)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      void window.ipc.invoke<OverlayGestureState>('overlays:beginGesture', id, mode, dir)
        .then((state) => {
          if (!active) {
            void window.ipc.invoke('overlays:finishGesture', id).catch(() => undefined)
            return
          }
          started = true
          applyPosition(state.basePosition)
          requestLiveUpdate()
        })
        .catch(() => undefined)
    },
    [hitTest, reportHit]
  )

  useEffect(() => {
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', setSnapshot)
    const offState = window.ipc.subscribe<OverlayListItem[]>('overlays:state', (items) => {
      if (Array.isArray(items)) setConfig((current) => mergeHifiOverlayConfigs(configFromItems(items, current)))
    })
    const offRefresh = window.ipc.subscribe<null>('overlays:compositorRefresh', () => {
      void window.ipc.invoke<OverlaysConfig>('overlays:getConfig').then((next) => setConfig(mergeHifiOverlayConfigs(next))).catch(() => undefined)
    })
    void window.ipc.invoke<TelemetrySnapshot | null>('telemetry:getLatest').then(setSnapshot).catch(() => setSnapshot(null))
    void window.ipc.invoke<OverlaysConfig>('overlays:getConfig').then((next) => setConfig(mergeHifiOverlayConfigs(next))).catch(() => undefined)
    return () => {
      reportHit(false)
      if (hitHeartbeatRef.current) {
        clearInterval(hitHeartbeatRef.current)
        hitHeartbeatRef.current = null
      }
      offTelemetry()
      offState()
      offRefresh()
    }
  }, [reportHit])

  return (
    <main
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: 'transparent' }}
      onMouseMove={(event) => reportHit(hitTest(event.clientX, event.clientY))}
      onMouseLeave={() => reportHit(false)}
    >
      {enabledLayers.map(({ definition, config: widgetConfig }) => {
        const Widget = resolveWidgetComponent(definition.id)
        if (!Widget) return null
        // Trigger-only overlays are condition-gated ONLY once locked (racing). While
        // unlocked (editing) they always show so the user can position/style them.
        if (widgetConfig.locked && !isTriggered(widgetConfig)) return null
        const layerStyle: CSSProperties = {
          position: 'absolute',
          left: widgetConfig.position.x - display.x,
          top: widgetConfig.position.y - display.y,
          width: widgetConfig.position.width,
          height: widgetConfig.position.height,
          opacity: widgetConfig.opacity / 100,
          pointerEvents: widgetConfig.locked ? 'none' : 'auto'
        }
        return (
          <section
            key={definition.id}
            style={layerStyle}
            onMouseDown={(event) => beginGesture(event, definition.id, 'move', '')}
          >
            <div
              className={`overlay-shell${widgetConfig.locked ? '' : ' draggable'}`}
              style={shellStyle(widgetConfig)}
            >
              {!widgetConfig.locked && (
                <div className="overlay-drag-handle">
                  {definition.title} · compositor · drag to move
                </div>
              )}
              <Widget snapshot={snapshot} config={widgetConfig} />
              {!widgetConfig.locked &&
                RESIZE_DIRS.map((dir) => (
                  <div
                    key={dir}
                    className={`overlay-resize ${dir}`}
                    onMouseDown={(event) => {
                      event.stopPropagation()
                      beginGesture(event, definition.id, 'resize', dir)
                    }}
                  />
                ))}
            </div>
          </section>
        )
      })}
      {!snapshot?.connected && <div className="connection-badge">waiting for telemetry</div>}
    </main>
  )
}
