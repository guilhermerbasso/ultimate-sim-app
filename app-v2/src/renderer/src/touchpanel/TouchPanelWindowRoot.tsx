import { useEffect, useState, type ReactElement } from 'react'
import { parseButtonBoxPanel, type ButtonBoxPanel } from '../../../shared/touch-panel'
import type { StreamingTouchInteractionSession } from '../../../shared/streaming'
import { ButtonBoxRenderer, type TouchRuntimeFeedback } from './ButtonBoxRenderer'
import {
  executeTouchControlAction,
  fetchStreamInteractionHealth,
  fetchStreamPanel,
  isBrowserStreamRuntime
} from './runtime'
import { useTouchExpressionValues } from './useTouchExpressionValues'
import './buttonbox.css'

// Fullscreen renderer for an editable RGB button-box panel. Mirrors the pit-panel
// window: minimal `window.ipc` bridge, loads the panel by id from the query string
// and fires each key's bound action over the existing IPC channels.

function panelIdFromQuery(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const panel = params.get('panel')
    if (panel) return panel
    const match = window.location.pathname.match(/^\/touch\/([^/]+)$/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

// Is this window running OS-fullscreen (frameless)? When windowed, the native window
// chrome already provides a close button, so the floating ✕ is redundant and its
// top-right position risks covering a button + accidental closes. Default to `true`
// (show ✕) so a detection miss never traps the user with no way out.
function detectFullscreen(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: fullscreen)')?.matches) return true
  } catch {
    // matchMedia unavailable
  }
  try {
    const w = window.screen?.width
    const h = window.screen?.height
    if (typeof w === 'number' && typeof h === 'number') {
      return window.innerWidth >= w && window.innerHeight >= h
    }
  } catch {
    // screen metrics unavailable
  }
  return true
}

export function TouchPanelWindowRoot(): ReactElement {
  const [panel, setPanel] = useState<ButtonBoxPanel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState<boolean>(() => detectFullscreen())
  const [feedback, setFeedback] = useState<TouchRuntimeFeedback | null>(null)
  const [interaction, setInteraction] = useState<StreamingTouchInteractionSession | null>(null)
  const browserStream = isBrowserStreamRuntime()
  const expressionValues = useTouchExpressionValues(panel?.buttons)

  useEffect(() => {
    const id = panelIdFromQuery()
    if (!id) {
      setError('No panel specified.')
      return
    }
    let alive = true
    const loadPanel = browserStream ? fetchStreamPanel(id) : window.ipc.invoke('app:touchpanel:get', id)
    void loadPanel
      .then((raw) => {
        if (!alive) return
        const browserPayload = browserStream ? raw as Awaited<ReturnType<typeof fetchStreamPanel>> : null
        const parsed = parseButtonBoxPanel(browserPayload ? browserPayload.panel : raw)
        if (browserPayload) setInteraction(browserPayload.interaction)
        if (parsed) setPanel(parsed)
        else setError('Panel not found.')
      })
      .catch(() => alive && setError('Failed to load panel.'))

    // Live-refresh the open window when the panel is edited in the app.
    const off = browserStream ? () => {} : window.ipc.subscribe('app:touchpanel:updated', (raw) => {
      const parsed = parseButtonBoxPanel(raw)
      if (parsed && parsed.id === id) setPanel(parsed)
    })

    return () => {
      alive = false
      off()
    }
  }, [browserStream])

  useEffect(() => {
    const update = (): void => setFullscreen(detectFullscreen())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  useEffect(() => {
    if (!feedback || feedback.pending) return
    const timer = window.setTimeout(() => setFeedback(null), feedback.ok ? 2_500 : 6_000)
    return () => window.clearTimeout(timer)
  }, [feedback])
  useEffect(() => {
    if (!browserStream || !panel) return
    let alive = true
    const refresh = (): void => {
      void fetchStreamInteractionHealth(panel.id)
        .then((health) => {
          if (!alive) return
          setInteraction((current) => current
            ? {
                ...current,
                health: health.health,
                expiresAt: health.expiresAt,
                leaseExpiresAt: health.leaseExpiresAt,
                activeControls: health.activeControls,
                lastFeedback: health.lastFeedback
              }
            : current)
        })
        .catch(() => {
          if (alive) setInteraction((current) => current ? { ...current, health: 'degraded' } : current)
        })
    }
    const timer = window.setInterval(refresh, 10_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [browserStream, panel])

  if (error) {
    return (
      <div style={{ color: '#fca5a5', padding: 24, fontFamily: 'Segoe UI, system-ui, sans-serif' }}>{error}</div>
    )
  }
  if (!panel) {
    return <div style={{ color: '#9aa6b2', padding: 24, fontFamily: 'Segoe UI, system-ui, sans-serif' }}>Loading…</div>
  }

  // Reserve top padding so the floating ✕ (top-right) can never cover the corner
  // button cell when it is shown.
  const closeButtonSize = { width: 56, height: 48 }
  const showCloseButton = fullscreen && !browserStream
  const showInteractionIndicator = browserStream && interaction !== null
  const safeTopPad = Math.max(
    showCloseButton ? closeButtonSize.height + 20 : 0,
    showInteractionIndicator ? 54 : 0
  )

  const onRuntimeFeedback = (next: TouchRuntimeFeedback): void => {
    setFeedback(next)
    if (!next.pending) {
      setInteraction((current) => current
        ? {
            ...current,
            health: next.ok ? 'ready' : 'degraded',
            lastFeedback: next.message ?? current.lastFeedback
          }
        : current)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: panel.background, boxSizing: 'border-box', paddingTop: safeTopPad }}>
      {showCloseButton ? (
        <button
          type="button"
          aria-label="Close"
          onClick={() => void window.ipc.invoke('app:touchpanel:close')}
          style={{
            position: 'fixed',
            top: 10,
            right: 10,
            zIndex: 10,
            width: closeButtonSize.width,
            height: closeButtonSize.height,
            borderRadius: 10,
            border: '1px solid #2a323d',
            background: 'rgba(20,24,31,0.85)',
            color: '#f3f4f6',
            fontSize: 20,
            cursor: 'pointer'
          }}
        >
          ✕
        </button>
      ) : null}
      {showInteractionIndicator ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 8,
            left: 10,
            right: 10,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minHeight: 36,
            padding: '6px 12px',
            border: `1px solid ${interaction.health === 'ready' ? '#22c55e' : '#f59e0b'}`,
            borderRadius: 10,
            background: 'rgba(2, 6, 23, 0.94)',
            color: '#f8fafc',
            font: '800 12px/1.2 Segoe UI, system-ui, sans-serif',
            letterSpacing: '0.06em',
            pointerEvents: 'none'
          }}
        >
          <span>● {interaction.indicator}</span>
          <span style={{ color: interaction.health === 'ready' ? '#86efac' : '#fcd34d' }}>
            {interaction.health.toUpperCase()} · {interaction.capabilities.length} ALLOWED
            {interaction.activeControls > 0 ? ` · ${interaction.activeControls} ACTIVE` : ''}
          </span>
        </div>
      ) : null}
      <ButtonBoxRenderer
        panel={panel}
        expressionValues={expressionValues}
        onAction={executeTouchControlAction}
        onFeedback={onRuntimeFeedback}
        interactive={!browserStream || interaction?.interactive === true}
        reportLifecycle={browserStream}
      />
      {feedback ? (
        <div
          role={feedback.ok ? 'status' : 'alert'}
          aria-live={feedback.ok ? 'polite' : 'assertive'}
          style={{
            position: 'fixed',
            left: 12,
            right: 12,
            bottom: 10,
            zIndex: 20,
            minHeight: 44,
            padding: '10px 14px',
            border: `2px solid ${feedback.ok ? '#22c55e' : '#ef4444'}`,
            borderRadius: 10,
            background: 'rgba(2, 6, 23, 0.94)',
            color: '#f8fafc',
            font: '700 14px/1.4 Segoe UI, system-ui, sans-serif',
            pointerEvents: 'none'
          }}
        >
          {feedback.pending ? 'Working…' : feedback.message ?? (feedback.ok ? 'Action complete.' : 'Action failed.')}
        </div>
      ) : null}
    </div>
  )
}
