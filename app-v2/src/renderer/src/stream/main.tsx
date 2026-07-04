import React from 'react'
import ReactDOM from 'react-dom/client'
import { StreamOverlayRoot } from './StreamOverlayRoot'
import './streaming.css'
import '../overlay/overlay-runtime.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StreamOverlayRoot />
  </React.StrictMode>
)
