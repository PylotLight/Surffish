import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installWakeSnapshotLayer } from './lib/wake-snapshot-layer'

// The toolbar surface draws waking tabs' snapshots over the page area (lib/wake-snapshot-layer.ts).
if (new URLSearchParams(window.location.search).get('surface') === 'toolbar') installWakeSnapshotLayer()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

const markOnce = (name: string): void => {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name)
}

/**
 * Start-up user-timing marks read by the perf bench (scripts/perf/bench.cjs):
 * `surffish:first-commit` once the surface's first React render has committed (its script loaded,
 * compiled and ran), and `surffish:first-frame` once the frame after it has been produced (only on a
 * surface that is on screen: hidden views never tick rAF). The toolbar is hidden on a New Tab page and
 * never reports paint timing, so its commit is the toolbar's start-up number. Two marks, no listeners.
 */
function StartupMarks(): null {
  useEffect(() => {
    markOnce('surffish:first-commit')
    requestAnimationFrame(() => requestAnimationFrame(() => {
      markOnce('surffish:first-frame')
    }))
  }, [])
  return null
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
    <StartupMarks />
  </StrictMode>
)
