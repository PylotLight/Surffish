import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { isTypingIn, nextAddressValue, type AddressSyncReason } from '../../../shared/address-bar-sync'

/**
 * Keeps the address bar in step with the active tab (see shared/address-bar-sync): the tab's URL
 * wins unless the user is really typing. Returns the input's blur handler and a `markSynced` for
 * code that sets the bar to the tab URL itself (Esc, a finished navigation).
 */
export function useAddressBarSync({
  inputRef,
  address,
  setAddress,
  displayUrl,
  tabKey
}: {
  inputRef: RefObject<HTMLInputElement | null>
  address: string
  setAddress: (value: string) => void
  /** What the active tab wants shown ('' on the local New Tab page). */
  displayUrl: string
  /** Changes when another tab becomes active. */
  tabKey: string
}): { onBlur: () => void; markSynced: (value: string) => void } {
  const syncedRef = useRef(displayUrl)
  const valueRef = useRef(address)
  const displayRef = useRef(displayUrl)
  const selectAllRef = useRef(false)
  useLayoutEffect(() => {
    valueRef.current = address
    displayRef.current = displayUrl
  })

  const sync = useCallback((reason: AddressSyncReason) => {
    const input = inputRef.current
    const next = displayRef.current
    const typing = isTypingIn(input, document)
    const value = nextAddressValue({ value: valueRef.current, synced: syncedRef.current, next, typing, reason })
    if (value === null) {
      // Already showing the tab URL (e.g. after Esc): that's the new "unedited" baseline.
      if (valueRef.current === next) syncedRef.current = next
      return
    }
    // A focused bar with the whole URL selected stays fully selected, so typing still replaces it.
    // Reselect as soon as React commits the new value (a rAF is too late: a keystroke that lands
    // before the next frame would be appended to the new URL instead of replacing it).
    selectAllRef.current = typing && input !== null && input.selectionStart === 0 && input.selectionEnd === input.value.length
    syncedRef.current = value
    valueRef.current = value
    setAddress(value)
  }, [inputRef, setAddress])

  useLayoutEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current = false
    const input = inputRef.current
    if (input && document.activeElement === input && input.value === address) input.select()
  }, [address, inputRef])

  useEffect(() => { sync('url') }, [displayUrl, sync])
  useEffect(() => { sync('tab') }, [tabKey, sync])

  const onBlur = useCallback(() => sync('blur'), [sync])
  const markSynced = useCallback((value: string) => { syncedRef.current = value }, [])
  return { onBlur, markSynced }
}
