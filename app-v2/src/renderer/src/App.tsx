import { Suspense, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { Config, DeviceInfo, Mapping } from '../../shared/ipc'
import type { AppSettings } from '../../shared/settings'
import { applyAppTheme } from './lib/theme'
import { useGlobalActionRuntime } from './lib/action-runtime'
import { useEngineerActionRuntime } from './lib/engineer-action-runtime'
import { useSoundshiftRuntime } from './lib/soundshift-runtime'
import { useSpotterRuntime } from './lib/spotter-runtime'
import { useHapticsRuntime } from './lib/haptics-runtime'
import { useTtsRuntime, speakViaTts } from './lib/tts-runtime'
import { useSpotter3DRuntime } from './lib/spotter3d-runtime'
import { useWakeWord } from './lib/wake-word'
import { WakeWordIndicator } from './components/WakeWordIndicator'
import { ENGINEER_CHANNELS, type EngineerAnswer, type EngineerProactiveEvent } from '../../shared/engineer-ipc'
import { COACH_CHANNELS, type CoachSpeakEvent } from '../../shared/coach'
import { useDevices } from './lib/devices/DeviceRegistry'
import { ViewIcon } from './views/icons'
import { viewRegistry, type ViewDef } from './views/registry'
import { CommandPalette } from './components/CommandPalette'
import { BrandLogo } from './components/BrandLogo'
import { OnboardingFlow } from './onboarding/OnboardingFlow'
import { navSections } from './navigation/navModel'
import './styles/navigation.css'

type ToastTone = 'success' | 'error' | 'info'

const FAVORITES_STORAGE_KEY = 'usa.favorites'
const RECENTS_STORAGE_KEY = 'usa.recents'
const ONBOARDING_STORAGE_KEY = 'usa.onboardingCompleted'
const MAX_RECENTS = 5

export interface ToastState {
  message: string
  tone: ToastTone
}

export interface AppViewProps {
  connectedDevice: DeviceInfo | null
  mapping: Mapping | null
  config: Config | null
  setConnectedDevice(device: DeviceInfo | null): void
  refreshDeviceState(): Promise<void>
  showToast(message: string, tone?: ToastTone): void
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readStoredViewIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeStoredViewIds(key: string, ids: string[]): void {
  window.localStorage.setItem(key, JSON.stringify(ids))
}

function readOnboardingCompleted(): boolean {
  try {
    return Boolean(window.localStorage.getItem(ONBOARDING_STORAGE_KEY))
  } catch {
    return true
  }
}

function App(): ReactElement {
  // The connected SIM-X primary now lives in the shared device registry, so a
  // device connected in DevicesView is reflected here (sidebar) and in every
  // other menu without reconnecting.
  const { primaryDevice: connectedDevice, setPrimaryDevice } = useDevices()
  const [activeId, setActiveId] = useState<string>(viewRegistry[0].id)
  const [favorites, setFavorites] = useState<string[]>(() => readStoredViewIds(FAVORITES_STORAGE_KEY))
  const [recents, setRecents] = useState<string[]>(() => readStoredViewIds(RECENTS_STORAGE_KEY))
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => !readOnboardingCompleted())

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 4200)
  }, [])

  useGlobalActionRuntime(showToast)
  useEngineerActionRuntime(showToast)
  useSoundshiftRuntime()
  useSpotterRuntime()
  useHapticsRuntime()
  useTtsRuntime()
  useSpotter3DRuntime()
  useWakeWord()

  const viewById = useMemo(() => new Map(viewRegistry.map((view) => [view.id, view])), [])

  const current = useMemo(
    () => viewById.get(activeId) ?? viewRegistry[0],
    [activeId, viewById]
  )

  // Global speech for the AI Engineer: wake-word answers + proactive per-sector
  // coaching are spoken on ANY screen. The Engineer view only renders the feed, so
  // this single consumer is the SOLE speaker — no double-speak, no missed-speak.
  // The Live Coach's own per-tip call-out (`coach:speak`) is spoken here too, beside
  // the engineer feed, so the user hears the coach on every screen (the Coach view
  // only renders the report; nothing else consumed this channel → it was silent).
  useEffect(() => {
    const speakIf = (text: string, lang: string | undefined, speak: boolean, diag?: { source?: string; tipId?: string; corner?: number }): void => {
      if (speak && text) void speakViaTts(text, { lang, ...diag })
    }
    const unsubAnswer = window.ipc.subscribe<EngineerAnswer>(ENGINEER_CHANNELS.answer, (a) =>
      speakIf(a.text, (a as { lang?: string }).lang, a.speak, { source: 'engineer', tipId: (a as { id?: string }).id })
    )
    const unsubProactive = window.ipc.subscribe<EngineerProactiveEvent>(ENGINEER_CHANNELS.proactive, (e) =>
      speakIf(e.text, e.lang, e.speak, { source: e.source ?? 'engineer', tipId: e.id, corner: e.corner })
    )
    // The coach engine only emits `coach:speak` when its speakTopTip is on and the
    // cooldown elapsed, so there is no separate speak flag to honor — text presence
    // is the gate. Voice/lang resolution (and the user's selected voice) is handled
    // by speakViaTts.
    const unsubCoach = window.ipc.subscribe<CoachSpeakEvent>(COACH_CHANNELS.speak, (e) =>
      speakIf(e.text, e.lang, true, { source: e.source ?? 'coach', tipId: e.tipId, corner: e.corner })
    )
    return () => {
      unsubAnswer()
      unsubProactive()
      unsubCoach()
    }
  }, [])

  const sidebarSections = useMemo(
    () => navSections.map((section) => ({
      ...section,
      items: section.viewIds.map((id) => viewById.get(id)).filter((view): view is ViewDef => Boolean(view))
    })),
    [viewById]
  )

  const favoriteViews = useMemo(
    () => favorites.map((id) => viewById.get(id)).filter((view): view is ViewDef => Boolean(view)),
    [favorites, viewById]
  )

  const recentViews = useMemo(
    () => recents.map((id) => viewById.get(id)).filter((view): view is ViewDef => Boolean(view)).slice(0, MAX_RECENTS),
    [recents, viewById]
  )

  const refreshDeviceState = useCallback(async () => {
    try {
      const [nextMapping, nextConfig] = await Promise.all([window.api.getMapping(), window.api.getConfig()])
      setMapping(nextMapping)
      setConfig(nextConfig)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      throw error
    }
  }, [showToast])

  const viewProps: AppViewProps = {
    connectedDevice,
    mapping,
    config,
    setConnectedDevice: setPrimaryDevice,
    refreshDeviceState,
    showToast
  }

  const activateView = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((currentFavorites) => (
      currentFavorites.includes(id)
        ? currentFavorites.filter((favoriteId) => favoriteId !== id)
        : [...currentFavorites, id]
    ))
  }, [])

  const closeOnboarding = useCallback(() => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
    } catch {
      // Continue even if localStorage is unavailable.
    }
    setFavorites(readStoredViewIds(FAVORITES_STORAGE_KEY))
    setShowOnboarding(false)
  }, [])

  const renderNavRow = useCallback((view: ViewDef, context: string) => {
    const isPinned = favorites.includes(view.id)

    return (
      <div className="nav-row" key={`${context}-${view.id}`}>
        <button
          className={`nav-item ${view.id === activeId ? 'is-active' : ''}`}
          aria-current={view.id === activeId ? 'page' : undefined}
          onClick={() => activateView(view.id)}
          type="button"
        >
          <span className="nav-icon"><ViewIcon id={view.id} /></span>
          <span>
            <strong>{view.label}</strong>
          </span>
        </button>
        <button
          aria-label={isPinned ? `Remover ${view.label} dos favoritos` : `Adicionar ${view.label} aos favoritos`}
          className={`nav-pin ${isPinned ? 'is-pinned' : ''}`}
          onClick={() => toggleFavorite(view.id)}
          title={isPinned ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          type="button"
        >
          {isPinned ? '★' : '☆'}
        </button>
      </div>
    )
  }, [activeId, activateView, favorites, toggleFavorite])

  // Mapping/config only make sense while the SIM-X is connected. Clearing them
  // here keeps every disconnect path (registry action, DevicesView, ArduinosView)
  // consistent now that the primary device lives in the shared registry.
  useEffect(() => {
    if (!connectedDevice) {
      setMapping(null)
      setConfig(null)
    }
  }, [connectedDevice])

  useEffect(() => {
    writeStoredViewIds(FAVORITES_STORAGE_KEY, favorites.filter((id) => viewById.has(id)))
  }, [favorites, viewById])

  useEffect(() => {
    writeStoredViewIds(RECENTS_STORAGE_KEY, recents.filter((id) => viewById.has(id)).slice(0, MAX_RECENTS))
  }, [recents, viewById])

  useEffect(() => {
    if (!viewById.has(activeId)) return
    setRecents((currentRecents) => [
      activeId,
      ...currentRecents.filter((id) => id !== activeId)
    ].slice(0, MAX_RECENTS))
  }, [activeId, viewById])

  const Active = current.Component

  useEffect(() => {
    window.ipc
      .invoke<AppSettings>('app:getSettings')
      .then(applyAppTheme)
      .catch((error) => showToast(getErrorMessage(error), 'error'))
  }, [showToast])

  // Global command palette shortcut (Ctrl/Cmd+K) to jump to any view.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app-root">
      <WakeWordIndicator />
      <main className="app-shell">
        <aside className="sidebar" aria-label="Navegação principal">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true"><BrandLogo /></div>
            <div>
              <span className="brand-kicker">Sim Racing</span>
              <h1>Ultimate Sim App</h1>
            </div>
          </div>

          <button className="nav-search" type="button" onClick={() => setPaletteOpen(true)}>
            <span className="nav-search-icon" aria-hidden="true">⌕</span>
            <span>Buscar telas…</span>
            <kbd>⌘K</kbd>
          </button>

          <nav className="nav-list nav-list--sections">
            <div className="nav-quick-group" aria-label="Favoritos">
              <div className="nav-quick-title">
                <span>Favoritos</span>
                <span className="nav-quick-count">{favoriteViews.length}</span>
              </div>
              {favoriteViews.length > 0
                ? favoriteViews.map((view) => renderNavRow(view, 'favorite'))
                : <div className="nav-empty-state">Fixe telas com a estrela para acesso rápido.</div>}
            </div>

            {recentViews.length > 0 && (
              <div className="nav-quick-group" aria-label="Recentes">
                <div className="nav-quick-title">
                  <span>Recentes</span>
                  <span className="nav-quick-count">{recentViews.length}</span>
                </div>
                {recentViews.map((view) => renderNavRow(view, 'recent'))}
              </div>
            )}

            {sidebarSections.map((section) => (
              <div className="nav-group" key={section.title}>
                <span className="nav-group-label nav-section-heading">{section.title}</span>
                {section.items.map((view) => renderNavRow(view, section.title))}
                <div className="nav-divider"></div>
              </div>
            ))}
          </nav>

          <div className={`sidebar-card ${connectedDevice ? 'is-online' : ''}`}>
            <span className="status-dot" />
            <div>
              <strong>{connectedDevice ? 'SIM-X conectado' : 'SIM-X desconectado'}</strong>
              <p>{connectedDevice ? `${connectedDevice.path} · FW ${connectedDevice.firmwareVersion}` : 'Conecte em Dispositivos'}</p>
            </div>
          </div>
        </aside>

        <section className="content-panel">
          <header className="content-header">
            <div>
              <span className="section-eyebrow">{current.eyebrow}</span>
              <h2>{current.label}</h2>
              <p>{current.description}</p>
            </div>
          </header>

          <div className="view-stage">
            <Suspense fallback={(
              <div className="nav-loading-state" role="status">
                <div className="nav-loading-card">
                  <div className="nav-loading-pulse" aria-hidden="true" />
                  <strong>Carregando tela…</strong>
                </div>
              </div>
            )}>
              <Active {...viewProps} />
            </Suspense>
          </div>
        </section>

        {toast && <div className={`toast toast-${toast.tone}`} role="status">{toast.message}</div>}
      </main>

      <CommandPalette
        open={paletteOpen}
        activeId={activeId}
        onClose={() => setPaletteOpen(false)}
        onSelect={(id) => {
          setActiveId(id)
          setPaletteOpen(false)
        }}
      />

      {showOnboarding && (
        <OnboardingFlow
          onClose={closeOnboarding}
          onNavigate={(id) => setActiveId(id)}
        />
      )}
    </div>
  )
}

export default App
