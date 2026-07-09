import './views-harness-stubs'

import { Suspense, type ReactElement, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { DeviceRegistryProvider } from '@renderer/lib/devices/DeviceRegistry'
import type { AppViewProps } from '@renderer/App'
import { viewRegistry } from '@renderer/views/registry'
import { ViewIcon } from '@renderer/views/icons'
import { BrandLogo } from '@renderer/components/BrandLogo'
import { navSections } from '@renderer/navigation/navModel'
import { t, translateNavTitle, translateView } from '@renderer/i18n'
import { WidgetErrorBoundary } from './ErrorBoundary'
import '@renderer/styles/theme.css'
import '@renderer/styles/glass.css'
import '@renderer/styles/navigation.css'
import './gallery.css'

const language = 'en' as const

function selectedViewId(): string {
  const requested = new URLSearchParams(window.location.search).get('view')
  return viewRegistry.some((view) => view.id === requested) ? requested as string : viewRegistry[0].id
}

function Shell(): ReactElement {
  const activeId = selectedViewId()
  const views = useMemo(() => viewRegistry.map((view) => translateView(view, language)), [])
  const byId = useMemo(() => new Map(views.map((view) => [view.id, view])), [views])
  const current = byId.get(activeId) ?? views[0]
  const Active = current.Component
  const viewProps: AppViewProps = {
    connectedDevice: null,
    mapping: null,
    config: null,
    setConnectedDevice: () => undefined,
    refreshDeviceState: async () => undefined,
    showToast: () => undefined,
    language
  }
  const sidebarSections = navSections.map((section) => ({
    ...section,
    items: section.viewIds.map((id) => byId.get(id)).filter((view): view is typeof current => Boolean(view))
  }))

  ;(window as unknown as { __viewRegistryMeta?: unknown }).__viewRegistryMeta = views.map((view) => ({
    id: view.id,
    label: view.label,
    group: view.group,
    description: view.description
  }))

  return (
    <div className="app-root" data-view-id={current.id}>
      <main className="app-shell">
        <aside id="app-sidebar" className="sidebar" aria-label={t(language, 'mainNav')}>
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true"><BrandLogo /></div>
            <div className="brand-text">
              <span className="brand-kicker">Sim Racing</span>
              <h1>Ultimate Sim App</h1>
            </div>
          </div>
          <button className="nav-search" type="button">
            <span className="nav-search-icon" aria-hidden="true">⌕</span>
            <span>{t(language, 'searchScreens')}</span>
            <kbd>⌘K</kbd>
          </button>
          <nav className="nav-list nav-list--sections">
            <div className="nav-quick-group" aria-label={t(language, 'favorites')}>
              <div className="nav-quick-title">
                <span>{t(language, 'favorites')}</span>
                <span className="nav-quick-count">0</span>
              </div>
              <div className="nav-empty-state">{t(language, 'favoritesEmpty')}</div>
            </div>
            {sidebarSections.map((section) => (
              <div className="nav-group" key={section.title}>
                <span className="nav-group-label nav-section-heading">{translateNavTitle(section.title, language)}</span>
                {section.items.map((view) => (
                  <div className="nav-row" key={view.id}>
                    <button className={`nav-item ${view.id === current.id ? 'is-active' : ''}`} type="button">
                      <span className="nav-icon"><ViewIcon id={view.id} /></span>
                      <span><strong>{view.label}</strong></span>
                    </button>
                    <button className="nav-pin" type="button">☆</button>
                  </div>
                ))}
                <div className="nav-divider"></div>
              </div>
            ))}
          </nav>
          <div className="sidebar-card" role="status">
            <span className="status-dot" />
            <div>
              <strong>{t(language, 'simXDisconnected')}</strong>
              <p>{t(language, 'connectInDevices')}</p>
            </div>
          </div>
        </aside>
        <section className="content-panel" data-shot-target="true">
          <header className="content-header">
            <div>
              <span className="section-eyebrow">{current.eyebrow}</span>
              <h2>{current.label}</h2>
              <p>{current.description}</p>
            </div>
            <span className="support-button">{t(language, 'supportButton')}</span>
          </header>
          <div className="view-stage" data-view-stage={current.id}>
            <WidgetErrorBoundary id={current.id}>
              <Suspense fallback={<div className="nav-loading-state" role="status">{t(language, 'loadingScreen')}</div>}>
                <Active {...viewProps} />
              </Suspense>
            </WidgetErrorBoundary>
          </div>
        </section>
      </main>
    </div>
  )
}

function ViewsGallery(): ReactElement {
  return (
    <DeviceRegistryProvider>
      <Shell />
    </DeviceRegistryProvider>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<ViewsGallery />)
