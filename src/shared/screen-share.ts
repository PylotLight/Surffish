/**
 * Screen sharing (navigator.mediaDevices.getDisplayMedia) policy and picker choices.
 *
 * Chrome's model: a page may *ask* to share the screen at any time it has a user gesture and is a
 * secure context (Blink enforces both); what gets shared is chosen by the user in a picker, and that
 * choice is the consent. There's no remembered per-site grant. Surffish does the same: the
 * `display-capture` permission is allowed for secure origins, and the picker decides.
 *
 * On macOS 15+ the picker is the system one (ScreenCaptureKit, `useSystemPicker`). Elsewhere, or if
 * it isn't available, Surffish shows its own small chooser built from these choices.
 */

export interface CaptureSourceInfo {
  id: string
  name: string
  /** `screen:…` or `window:…` (desktopCapturer ids). */
  kind: 'screen' | 'window'
}

export type ScreenShareChoice =
  | { kind: 'tab'; label: string }
  | { kind: 'source'; label: string; source: CaptureSourceInfo }

export const MAX_WINDOW_CHOICES = 6

/** May this origin ask for the screen picker? Secure contexts only (https, loopback http). */
export function screenShareAllowedFor(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname.endsWith('.localhost')
}

export function captureSourceKind(id: string): 'screen' | 'window' {
  return id.startsWith('screen:') ? 'screen' : 'window'
}

/**
 * The fallback chooser's options, in button order: this tab (when the request came from a top
 * frame), every screen, then up to MAX_WINDOW_CHOICES windows (Surffish's own windows left out:
 * "This tab" covers sharing the page itself, and sharing the browser window would mirror itself).
 */
export function buildScreenShareChoices(sources: readonly { id: string; name: string }[], options: { canShareTab: boolean; ownWindowNames?: readonly string[] }): ScreenShareChoice[] {
  const own = new Set(options.ownWindowNames ?? [])
  const choices: ScreenShareChoice[] = []
  if (options.canShareTab) choices.push({ kind: 'tab', label: 'This tab' })
  const screens = sources.filter((source) => captureSourceKind(source.id) === 'screen')
  screens.forEach((source, index) => {
    const label = screens.length === 1 ? 'Entire screen' : `Screen ${index + 1}${source.name && !/^(Entire screen|Screen \d+)$/i.test(source.name) ? ` (${source.name})` : ''}`
    choices.push({ kind: 'source', label, source: { id: source.id, name: source.name, kind: 'screen' } })
  })
  sources
    .filter((source) => captureSourceKind(source.id) === 'window' && source.name.trim() !== '' && !own.has(source.name))
    .slice(0, MAX_WINDOW_CHOICES)
    .forEach((source) => {
      const name = source.name.trim()
      choices.push({ kind: 'source', label: name.length > 48 ? `${name.slice(0, 47)}…` : name, source: { id: source.id, name, kind: 'window' } })
    })
  return choices
}
