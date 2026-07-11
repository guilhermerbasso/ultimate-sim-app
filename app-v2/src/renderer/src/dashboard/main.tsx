import React from 'react'
import ReactDOM from 'react-dom/client'
import { DashboardRoot } from './DashboardRoot'
import { UnitSystemProvider } from '../lib/units'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitSystemProvider>
      <DashboardRoot />
    </UnitSystemProvider>
  </React.StrictMode>
)
