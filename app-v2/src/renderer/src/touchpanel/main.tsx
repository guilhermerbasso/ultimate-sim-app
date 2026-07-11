import React from 'react'
import ReactDOM from 'react-dom/client'
import { TouchPanelWindowRoot } from './TouchPanelWindowRoot'
import { UnitSystemProvider } from '../lib/units'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitSystemProvider>
      <TouchPanelWindowRoot />
    </UnitSystemProvider>
  </React.StrictMode>
)
