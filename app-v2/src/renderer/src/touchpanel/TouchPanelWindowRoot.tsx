import { useEffect, useState, type ReactElement } from 'react'
import { parseButtonBoxPanel, type ButtonBoxPanel } from '../../../shared/touch-panel'
import { ButtonBoxRenderer } from './ButtonBoxRenderer'
import { executeButtonAction, fetchStreamPanel, isBrowserStreamRuntime } from './runtime'
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

  useEffect(() => {
    const id = panelIdFromQuery()
    if (!id) {
      setError('No panel specified.')
      return
    }
    let alive = true
    const loadPanel = isBrowserStreamRuntime() ? fetchStreamPanel(id) : window.ipc.invoke('app:touchpanel:get', id)
    void loadPanel
      .then((raw) => {
        if (!alive) return
        const parsed = parseButtonBoxPanel(raw)
        if (parsed) setPanel(parsed)
        else setError('Panel not found.')
      })
      .catch(() => alive && setError('Failed to load panel.'))

    // Live-refresh the open window when the panel is edited in the app.
    const off = isBrowserStreamRuntime() ? () => {} : window.ipc.subscribe('app:touchpanel:updated', (raw) => {
      const parsed = parseButtonBoxPanel(raw)
      if (parsed && parsed.id === id) setPanel(parsed)
    })

    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    const update = (): void => setFullscreen(detectFullscreen())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

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
  const showCloseButton = fullscreen && !isBrowserStreamRuntime()
  const safeTopPad = showCloseButton ? closeButtonSize.height + 20 : 0

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
      <ButtonBoxRenderer panel={panel} onPress={(button) => void executeButtonAction(button.action)} />
    </div>
  )
}
