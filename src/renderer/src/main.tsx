import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installWakeSnapshotLayer } from './lib/wake-snapshot-layer'

// The toolbar surface draws waking tabs' snapshots over the page area (lib/wake-snapshot-layer.ts).
if (new URLSearchParams(window.location.search).get('surface') === 'toolbar') installWakeSnapshotLayer()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
)
