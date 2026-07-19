import React from 'react'
import ReactDOM from 'react-dom/client'
import { ReceiverPwaRoot } from './ReceiverPwaRoot'
import './receiver.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ReceiverPwaRoot />
  </React.StrictMode>
)
