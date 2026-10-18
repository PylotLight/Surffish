import { useEffect, useState } from 'react'
import type { CastSnapshot } from '../../../../shared/cast'

const EMPTY: CastSnapshot = { enabled: false, scanning: false, devices: [], session: null }

/** The cast state main pushes (devices, the live cast); fetched once on mount. */
export function useCastSnapshot(): CastSnapshot {
  const [snapshot, setSnapshot] = useState<CastSnapshot>(EMPTY)
  useEffect(() => {
    let live = true
    const off = window.api.browser.cast.onState((next) => { if (live) setSnapshot(next) })
    void window.api.browser.cast.snapshot().then((next) => { if (live) setSnapshot(next) }).catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [])
  return snapshot
}
