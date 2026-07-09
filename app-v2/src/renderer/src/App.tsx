import { Suspense, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { Config, DeviceInfo, Mapping } from '../../shared/ipc'
import type { AppSettings } from '../../shared/settings'
import { DEFAULT_APP_SETTINGS } from '../../shared/settings'
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
import { UpdateBanner } from './components/UpdateBanner'
import { ReportBugButton } from './components/ReportBugButton'
import { OnboardingFlow } from './onboarding/OnboardingFlow'
import { TutorialLauncherButton } from './onboarding/TutorialLauncherButton'
import { TutorialOverlay } from './onboarding/TutorialOverlay'
import { getTutorial } from './onboarding/tutorialRegistry'
import {
  isTutorialSeen,
  markTutorialSeen,
  readTutorialAutoDisabled,
  writeTutorialAutoDisabled
} from './onboarding/tutorialStorage'
import { navSections } from './navigation/navModel'
import {
  APP_SETTINGS_CHANGED_EVENT,
  resolveAppLanguage,
  t,
  translateNavTitle,
  translateView,
  type ResolvedLanguage
} from './i18n'
import './styles/navigation.css'

type ToastTone = 'success' | 'error' | 'info'

const FAVORITES_STORAGE_KEY = 'usa.favorites'
const RECENTS_STORAGE_KEY = 'usa.recents'
const ONBOARDING_STORAGE_KEY = 'usa.onboardingCompleted'
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'usa:sidebar-collapsed'
const MAX_RECENTS = 5
const SUPPORT_URL = 'https://buymeacoffee.com/bettercalllbasso'

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
  language?: ResolvedLanguage
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

// Sidebar collapse is a small, non-critical piece of UI state; we persist it with
// the same read-on-init / write-on-change pattern used for favorites and recents.
// Exported so the persistence contract can be unit-tested without rendering App.
export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false')
  } catch {
    // Ignore storage failures (private mode, quota, etc.) — collapse is cosmetic.
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as Partial<HTMLElement> | null
  if (!element || typeof element !== 'object') return false
  const tagName = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : ''
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true
  if (element.isContentEditable === true) return true
  if (typeof element.closest === 'function') {
    return Boolean(element.closest('input, textarea, select'))
  }
  return false
}

// Optional image-icon hook. A view MAY expose an `iconImage` URL; when present we
// render it as an <img> and gracefully fall back to the built-in SVG icon if the
// image fails to load. The field is read defensively so we must not edit
// ViewDef in views/registry.tsx (owned by another track). Real images are added
// later. TODO(icons): add an optional `iconImage?: string` to ViewDef in
// views/registry.tsx to actually populate these — this renderer already supports
// it with SVG fallback.
function NavIcon({ view }: { view: ViewDef }): ReactElement {
  const iconImage = (view as ViewDef & { iconImage?: string }).iconImage
  const [imageFailed, setImageFailed] = useState(false)
  if (iconImage && !imageFailed) {
    return (
      <img
        className="nav-icon-img"
        src={iconImage}
        alt=""
        aria-hidden="true"
        onError={() => setImageFailed(true)}
      />
    )
  }
  return <ViewIcon id={view.id} />
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readSidebarCollapsed())
  const [showOnboarding, setShowOnboarding] = useState(() => !readOnboardingCompleted())
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null)
  const [tutorialAutoDisabled, setTutorialAutoDisabled] = useState(() => readTutorialAutoDisabled())
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)

  const language = useMemo(() => resolveAppLanguage(appSettings.language), [appSettings.language])
  const translatedViews = useMemo(() => viewRegistry.map((view) => translateView(view, language)), [language])

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

  const viewById = useMemo(() => new Map(translatedViews.map((view) => [view.id, view])), [translatedViews])

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
    showToast,
    language
  }

  const activateView = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed)
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

  const startCurrentTutorial = useCallback(() => {
    setActiveTutorialId(activeId)
  }, [activeId])

  const closeTutorial = useCallback((disableAutomatic: boolean) => {
    if (disableAutomatic) {
      writeTutorialAutoDisabled(true)
      setTutorialAutoDisabled(true)
    }
    setActiveTutorialId(null)
  }, [])

  const renderNavRow = useCallback((view: ViewDef, context: string) => {
    const isPinned = favorites.includes(view.id)

    return (
      <div className="nav-row" key={`${context}-${view.id}`}>
        <button
          className={`nav-item ${view.id === activeId ? 'is-active' : ''}`}
          aria-current={view.id === activeId ? 'page' : undefined}
          aria-label={sidebarCollapsed ? view.label : undefined}
          title={sidebarCollapsed ? view.label : undefined}
          onClick={() => activateView(view.id)}
          type="button"
        >
          <span className="nav-icon"><NavIcon view={view} /></span>
          <span>
            <strong>{view.label}</strong>
          </span>
        </button>
        <button
          aria-label={isPinned ? t(language, 'removeFavorite', { label: view.label }) : t(language, 'addFavorite', { label: view.label })}
          className={`nav-pin ${isPinned ? 'is-pinned' : ''}`}
          onClick={() => toggleFavorite(view.id)}
          title={isPinned ? t(language, 'removeFavorite', { label: view.label }) : t(language, 'addFavorite', { label: view.label })}
          type="button"
        >
          {isPinned ? '★' : '☆'}
        </button>
      </div>
    )
  }, [activeId, activateView, favorites, language, sidebarCollapsed, toggleFavorite])

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

  // Persist the collapsed rail state, mirroring the favorites/recents pattern above.
  useEffect(() => {
    writeSidebarCollapsed(sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!viewById.has(activeId)) return
    setRecents((currentRecents) => [
      activeId,
      ...currentRecents.filter((id) => id !== activeId)
    ].slice(0, MAX_RECENTS))
  }, [activeId, viewById])

  useEffect(() => {
    if (showOnboarding || tutorialAutoDisabled || activeTutorialId || !getTutorial(activeId) || isTutorialSeen(activeId)) return
    markTutorialSeen(activeId)
    setActiveTutorialId(activeId)
  }, [activeId, activeTutorialId, showOnboarding, tutorialAutoDisabled])

  const Active = current.Component
  const activeTutorial = activeTutorialId ? getTutorial(activeTutorialId) : null
  const activeTutorialView = activeTutorialId ? viewById.get(activeTutorialId) : null

  useEffect(() => {
    window.ipc
      .invoke<AppSettings>('app:getSettings')
      .then((settings) => {
        setAppSettings(settings)
        applyAppTheme(settings)
      })
      .catch((error) => showToast(getErrorMessage(error), 'error'))
  }, [showToast])

  useEffect(() => {
    const onSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<AppSettings>).detail
      if (!detail) return
      setAppSettings(detail)
      applyAppTheme(detail)
    }
    window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  // Global keyboard shortcuts: Ctrl/Cmd+K opens the command palette, Ctrl/Cmd+B
  // collapses/expands the sidebar rail. The two keys never clash with each other.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) return
      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault()
        setSidebarCollapsed((collapsed) => !collapsed)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const connectionStatusLabel = connectedDevice ? t(language, 'simXConnected') : t(language, 'simXDisconnected')
  const connectionStatusDescription = connectedDevice
    ? `${connectedDevice.path} · FW ${connectedDevice.firmwareVersion}`
    : t(language, 'connectInDevices')

  return (
    <div className="app-root">
      <WakeWordIndicator />
      <main className="app-shell">
        <aside
          id="app-sidebar"
          className="sidebar"
          data-collapsed={sidebarCollapsed ? 'true' : undefined}
          aria-label={t(language, 'mainNav')}
        >
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true"><BrandLogo /></div>
            <div className="brand-text">
              <span className="brand-kicker">Sim Racing</span>
              <h1>Ultimate Sim App</h1>
            </div>
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? t(language, 'expandSidebar') : t(language, 'collapseSidebar')}
              aria-expanded={!sidebarCollapsed}
              aria-controls="app-sidebar"
              title={sidebarCollapsed ? t(language, 'expandSidebar') : t(language, 'collapseSidebar')}
            >
              <svg
                className="sidebar-toggle-icon"
                viewBox="0 0 20 20"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5l-5 5 5 5" />
              </svg>
            </button>
          </div>

          <button
            className="nav-search"
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t(language, 'searchScreens')}
            title={sidebarCollapsed ? t(language, 'searchScreens') : undefined}
          >
            <span className="nav-search-icon" aria-hidden="true">⌕</span>
            <span>{t(language, 'searchScreens')}</span>
            <kbd>⌘K</kbd>
          </button>

          <nav className="nav-list nav-list--sections">
            <div className="nav-quick-group" aria-label={t(language, 'favorites')}>
              <div className="nav-quick-title">
                <span>{t(language, 'favorites')}</span>
                <span className="nav-quick-count">{favoriteViews.length}</span>
              </div>
              {favoriteViews.length > 0
                ? favoriteViews.map((view) => renderNavRow(view, 'favorite'))
                : <div className="nav-empty-state">{t(language, 'favoritesEmpty')}</div>}
            </div>

            {recentViews.length > 0 && (
              <div className="nav-quick-group" aria-label={t(language, 'recents')}>
                <div className="nav-quick-title">
                  <span>{t(language, 'recents')}</span>
                  <span className="nav-quick-count">{recentViews.length}</span>
                </div>
                {recentViews.map((view) => renderNavRow(view, 'recent'))}
              </div>
            )}

            {sidebarSections.map((section) => (
              <div className="nav-group" key={section.title}>
                <span className="nav-group-label nav-section-heading">{translateNavTitle(section.title, language)}</span>
                {section.items.map((view) => renderNavRow(view, section.title))}
                <div className="nav-divider"></div>
              </div>
            ))}
          </nav>

          <div
            className={`sidebar-card ${connectedDevice ? 'is-online' : ''}`}
            title={sidebarCollapsed ? (connectedDevice ? t(language, 'simXConnected') : t(language, 'simXDisconnected')) : undefined}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${connectionStatusLabel}. ${connectionStatusDescription}`}
          >
            <span className="status-dot" />
            <div>
              <strong>{connectionStatusLabel}</strong>
              <p>{connectionStatusDescription}</p>
            </div>
          </div>
        </aside>

        <section className="content-panel">
          <UpdateBanner language={language} />
          <header className="content-header">
            <div>
              <span className="section-eyebrow">{current.eyebrow}</span>
              <h2>{current.label}</h2>
              <p>{current.description}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <TutorialLauncherButton viewId={activeId} language={language} onStart={startCurrentTutorial} />
              <ReportBugButton language={language} showToast={showToast} />
              <a
                aria-label={t(language, 'supportAria')}
                className="support-button"
                href={SUPPORT_URL}
                rel="noreferrer"
                target="_blank"
                title={t(language, 'supportTitle')}
              >
                {t(language, 'supportButton')}
              </a>
            </div>
          </header>

          <div className="view-stage">
            <Suspense fallback={(
              <div className="nav-loading-state" role="status">
                <div className="nav-loading-card">
                  <div className="nav-loading-pulse" aria-hidden="true" />
                  <strong>{t(language, 'loadingScreen')}</strong>
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
        views={translatedViews}
        language={language}
      />

      {showOnboarding && (
        <OnboardingFlow
          onClose={closeOnboarding}
          onNavigate={(id) => setActiveId(id)}
        />
      )}

      {activeTutorial && activeTutorialView && (
        <TutorialOverlay
          tutorial={activeTutorial}
          viewLabel={activeTutorialView.label}
          language={language}
          onClose={closeTutorial}
        />
      )}
    </div>
  )
}

export default App
