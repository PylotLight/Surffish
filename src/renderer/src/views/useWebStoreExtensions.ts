import { useEffect, useState } from 'react'
import type { WebStoreExtensionsState } from '../../../shared/types'

export const EMPTY_WEB_STORE_EXTENSIONS: WebStoreExtensionsState = {
  extensions: [],
  busy: false,
  busyId: null,
  popupOpenId: null,
  notice: null,
  error: null
}

/** Live Chrome Web Store extension state from the main process. */
export function useWebStoreExtensions(): [WebStoreExtensionsState, (state: WebStoreExtensionsState) => void] {
  const [state, setState] = useState<WebStoreExtensionsState>(EMPTY_WEB_STORE_EXTENSIONS)
  useEffect(() => {
    const api = window.api.browser.extensions
    if (!api) return
    const unsubscribe = api.onChange(setState)
    void api.get().then(setState).catch(() => {})
    return unsubscribe
  }, [])
  return [state, setState]
}

export async function runExtensionAction(
  action: () => Promise<WebStoreExtensionsState>,
  setState: (state: WebStoreExtensionsState) => void,
  current: WebStoreExtensionsState
): Promise<void> {
  try {
    setState(await action())
  } catch (error) {
    setState({ ...current, error: error instanceof Error ? error.message : String(error) })
  }
}
