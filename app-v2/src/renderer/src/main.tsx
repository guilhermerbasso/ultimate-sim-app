import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DeviceRegistryProvider } from './lib/devices/DeviceRegistry'
import { UnitSystemProvider } from './lib/units'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ErrorRecoveryPanel } from './components/ErrorRecoveryPanel'
import { startRigPreflightEvidenceMonitor } from './lib/rig-preflight-client'
import './lib/log-client'
import './styles/theme.css'
import './styles/glass.css'
import './styles/error-recovery.css'

startRigPreflightEvidenceMonitor()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      scope="app-shell"
      fallback={(fallbackProps) => (
        <ErrorRecoveryPanel
          {...fallbackProps}
          variant="app"
          title="Ultimate Sim App could not start this session"
          detail="The app stopped instead of leaving a blank window. Export diagnostics to attach them to a report, then try again or reload."
        />
      )}
    >
      <UnitSystemProvider>
        <DeviceRegistryProvider>
          <App />
        </DeviceRegistryProvider>
      </UnitSystemProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
