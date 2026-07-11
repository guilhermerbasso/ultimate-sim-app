import React from 'react'
import ReactDOM from 'react-dom/client'
import { CompositorRoot } from './CompositorRoot'
import { UnitSystemProvider } from '../lib/units'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UnitSystemProvider>
      <CompositorRoot />
    </UnitSystemProvider>
  </React.StrictMode>
)
