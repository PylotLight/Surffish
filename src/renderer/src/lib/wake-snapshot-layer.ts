import {
  isWakeSnapshotPassthroughTarget,
  pointInRect,
  WAKE_SNAPSHOT_FADE_MS,
  type WakeSnapshotInput,
  type WakeSnapshotShowMessage
} from '../../../shared/wake-snapshot'

/**
 * Toolbar surface only: draws a waking tab's snapshot over the page area (main stretches the
 * toolbar view over the window meanwhile) and cross-fades it out when main says the page painted.
 * Plain DOM, outside React, so showing it never re-renders the toolbar. The picture sits under
 * every toolbar element (z-index -1 under transparent shell layers); presses and scrolls that land
 * on it, rather than on toolbar UI, are handed to the page and take the picture down: input never
 * stops at the snapshot.
 */

type Rect = WakeSnapshotShowMessage['rect']

function modifiersOf(event: MouseEvent | WheelEvent): string[] {
  const modifiers: string[] = []
  if (event.shiftKey) modifiers.push('shift')
  if (event.ctrlKey) modifiers.push('control')
  if (event.altKey) modifiers.push('alt')
  if (event.metaKey) modifiers.push('meta')
  return modifiers
}

function buttonOf(event: MouseEvent): 'left' | 'middle' | 'right' {
  return event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left'
}

export function installWakeSnapshotLayer(): () => void {
  const api = window.api.browser.wakeSnapshot
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let layer: HTMLImageElement | null = null
  let token: number | null = null
  let rect: Rect | null = null
  /** Token of a press being handed to the page (its moves and release follow it there). */
  let pressToken: number | null = null

  const remove = (): void => {
    layer?.remove()
    layer = null
    token = null
    rect = null
  }

  const offShow = api.onShow((message) => {
    remove()
    const image = document.createElement('img')
    image.className = 'wake-snapshot'
    image.alt = ''
    image.draggable = false
    image.decoding = 'sync'
    image.setAttribute('aria-hidden', 'true')
    image.dataset.token = String(message.token)
    Object.assign(image.style, {
      position: 'fixed',
      left: `${message.rect.x}px`,
      top: `${message.rect.y}px`,
      width: `${message.rect.width}px`,
      height: `${message.rect.height}px`,
      objectFit: 'cover',
      objectPosition: 'left top',
      zIndex: '-1',
      opacity: '1',
      pointerEvents: 'none',
      userSelect: 'none',
      transition: `opacity ${WAKE_SNAPSHOT_FADE_MS}ms ease-out`
    } satisfies Partial<CSSStyleDeclaration>)
    image.src = message.src
    document.body.prepend(image)
    layer = image
    token = message.token
    rect = message.rect
  })

  const offFade = api.onFade((fadeToken) => {
    if (!layer || token !== fadeToken) return
    const image = layer
    if (reducedMotion.matches) {
      remove()
      api.faded(fadeToken)
      return
    }
    image.classList.add('is-fading')
    let reported = false
    const report = (): void => {
      if (reported) return
      reported = true
      if (layer === image) remove()
      api.faded(fadeToken)
    }
    image.addEventListener('transitionend', report, { once: true })
    window.setTimeout(report, WAKE_SNAPSHOT_FADE_MS + 60)
    image.style.opacity = '0'
  })

  const offHide = api.onHide((hideToken) => {
    if (token === hideToken) remove()
  })

  /** A press/scroll on the picture (not on toolbar UI) at window point x,y. */
  const landsOnPage = (event: MouseEvent): boolean => {
    if (token === null || !rect || !pointInRect(event.clientX, event.clientY, rect)) return false
    return isWakeSnapshotPassthroughTarget(document.elementFromPoint(event.clientX, event.clientY))
  }

  const send = (forToken: number, input: WakeSnapshotInput): void => api.input(forToken, input)

  const onPointerDown = (event: PointerEvent): void => {
    if (!landsOnPage(event) || token === null) return
    event.preventDefault()
    event.stopPropagation()
    pressToken = token
    // The picture goes at once; the cover stays until the release so the page gets the whole click.
    layer?.remove()
    layer = null
    send(pressToken, { kind: 'mouseDown', x: event.clientX, y: event.clientY, button: buttonOf(event), clickCount: Math.max(1, event.detail), modifiers: modifiersOf(event) })
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (pressToken === null) return
    send(pressToken, { kind: 'mouseMove', x: event.clientX, y: event.clientY, button: buttonOf(event), clickCount: 0, modifiers: modifiersOf(event) })
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (pressToken === null) return
    event.preventDefault()
    event.stopPropagation()
    const pressed = pressToken
    pressToken = null
    remove()
    send(pressed, { kind: 'mouseUp', x: event.clientX, y: event.clientY, button: buttonOf(event), clickCount: Math.max(1, event.detail), modifiers: modifiersOf(event) })
  }
  const onWheel = (event: WheelEvent): void => {
    if (!landsOnPage(event) || token === null) return
    event.preventDefault()
    const wheelToken = token
    remove()
    send(wheelToken, { kind: 'mouseWheel', x: event.clientX, y: event.clientY, deltaX: event.deltaX, deltaY: event.deltaY, modifiers: modifiersOf(event) })
  }
  const onKeyDown = (): void => {
    // Typing while the picture shows and nothing in the toolbar has focus: it was meant for the page.
    if (token === null || (document.activeElement && document.activeElement !== document.body)) return
    const keyToken = token
    remove()
    send(keyToken, { kind: 'key' })
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerUp, true)
  window.addEventListener('wheel', onWheel, { capture: true, passive: false })
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    offShow()
    offFade()
    offHide()
    remove()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerUp, true)
    window.removeEventListener('wheel', onWheel, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}
