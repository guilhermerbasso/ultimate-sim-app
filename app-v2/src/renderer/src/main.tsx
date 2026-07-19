import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DeviceRegistryProvider } from './lib/devices/DeviceRegistry'
import { UnitSystemProvider } from './lib/units'
import { startRigPreflightEvidenceMonitor } from './lib/rig-preflight-client'
import './lib/log-client'
import './styles/theme.css'
import './styles/glass.css'

startRigPreflightEvidenceMonitor()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitSystemProvider>
      <DeviceRegistryProvider>
        <App />
      </DeviceRegistryProvider>
    </UnitSystemProvider>
  </React.StrictMode>
)
