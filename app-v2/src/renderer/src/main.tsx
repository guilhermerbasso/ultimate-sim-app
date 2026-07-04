import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DeviceRegistryProvider } from './lib/devices/DeviceRegistry'
import './lib/log-client'
import './styles/theme.css'
import './styles/glass.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DeviceRegistryProvider>
      <App />
    </DeviceRegistryProvider>
  </React.StrictMode>
)
