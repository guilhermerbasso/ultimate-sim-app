import React from 'react'
import ReactDOM from 'react-dom/client'
import { PitPanelRoot } from './PitPanelRoot'
import { UnitSystemProvider } from '../lib/units'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitSystemProvider>
      <PitPanelRoot />
    </UnitSystemProvider>
  </React.StrictMode>
)
