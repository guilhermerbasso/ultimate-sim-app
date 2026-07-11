import React from 'react'
import ReactDOM from 'react-dom/client'
import { OverlayRoot } from './OverlayRoot'
import { UnitSystemProvider } from '../lib/units'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitSystemProvider>
      <OverlayRoot />
    </UnitSystemProvider>
  </React.StrictMode>
)
