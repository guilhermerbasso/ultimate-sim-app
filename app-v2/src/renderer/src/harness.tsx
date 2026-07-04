import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/theme.css'
import { BrandLogo } from './components/BrandLogo'

function Harness() {
  return (
    <div className="app-root">
      <header className="title-bar">
        <div className="title-bar-title">SIM RACING ULTIMATE BUTTONBOX</div>
        <div className="title-bar-controls">
          <button className="btn-ghost win-minimize" type="button">─</button>
          <button className="btn-ghost win-maximize" type="button">□</button>
          <button className="btn-ghost win-close" type="button">×</button>
        </div>
      </header>
      <main className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-mark"><BrandLogo /></div>
            <div>
              <span className="brand-kicker">Sim Racing</span>
              <h1>ButtonBox</h1>
            </div>
          </div>
          <nav className="nav-list">
            <div className="nav-group">
              <span className="nav-group-label">General</span>
              <button className="nav-item is-active" type="button">
                <span className="nav-icon">▤</span>
                <span><strong>Dashboard</strong></span>
              </button>
              <button className="nav-item" type="button">
                <span className="nav-icon">⚙</span>
                <span><strong>Settings</strong></span>
              </button>
            </div>
          </nav>
        </aside>
        <section className="content-panel">
          <header className="content-header">
            <div>
              <span className="section-eyebrow">Overview</span>
              <h2>Component Gallery</h2>
            </div>
          </header>
          <div className="view-stage">
            <div className="panel-card" style={{ marginBottom: 16 }}>
              <div className="panel-heading-row">
                <h3>Telemetry</h3>
                <span className="telemetry-chip is-online"><span className="pulse"></span> ONLINE</span>
              </div>
              <p>Sample telemetry data showing formatting.</p>
              
              <div className="action-row">
                <button className="primary-action">START LOGGING</button>
                <button className="ghost-action">RESET</button>
                <button className="ghost-action danger">EMERGENCY STOP</button>
              </div>
            </div>

            <div className="panel-card">
              <h3>Inputs & Forms</h3>
              <div className="form-grid">
                <label>
                  <span>Driver Name</span>
                  <input type="text" className="text-field" placeholder="Enter name..." />
                </label>
                <div className="segmented" style={{marginTop: 16}}>
                  <button className="segment active">TELEMETRY</button>
                  <button className="segment">LOGS</button>
                  <button className="segment">HARDWARE</button>
                </div>
              </div>
            </div>

            <div style={{marginTop: 16}}>
              <div className="binding-table-header">
                <span>ACTION</span>
                <span>TYPE</span>
                <span>VALUE</span>
              </div>
              <div className="binding-table">
                <div className="binding-row">
                  <div className="binding-title-cell">
                    <div className="binding-led"></div>
                    <div>
                      <strong>Pit Limiter</strong>
                      <small>Toggle</small>
                    </div>
                  </div>
                  <div><span className="binding-type-pill">BUTTON</span></div>
                  <div><code>BTN_12</code></div>
                </div>
                <div className="binding-row is-disabled">
                  <div className="binding-title-cell">
                    <div className="binding-led"></div>
                    <div>
                      <strong>Ignition</strong>
                      <small>Hold</small>
                    </div>
                  </div>
                  <div><span className="binding-type-pill">SWITCH</span></div>
                  <div><code>SW_4</code></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />)
