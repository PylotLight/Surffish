/**
 * Permissions Chrome grants without a prompt. Blink still gates each on its own rules (a user
 * gesture and a focused page for clipboard writes, fullscreen and pointer lock), so allowing them here
 * only stops our deny-by-default site policy from breaking ordinary pages: GitHub's copy buttons,
 * YouTube's fullscreen button, browser games. Reading the clipboard is a per-site setting.
 */
const ALWAYS_ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock'])

export function isAlwaysAllowedPermission(permission: string): boolean {
  return ALWAYS_ALLOWED_PERMISSIONS.has(permission)
}

const PERMISSION_LABELS: Record<string, string> = {
  media: 'Camera/mic',
  geolocation: 'Location',
  'geolocation-approximate': 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  openExternal: 'Opening external apps',
  midi: 'MIDI',
  midiSysex: 'MIDI',
  'idle-detection': 'Idle detection',
  'window-management': 'Window management',
  'storage-access': 'Storage access',
  'top-level-storage-access': 'Storage access',
  'display-capture': 'Screen sharing',
  hid: 'HID devices',
  serial: 'Serial devices',
  usb: 'USB devices',
  keyboardLock: 'Keyboard lock',
  'speaker-selection': 'Speaker selection',
  unknown: 'A permission'
}

/** Permissions the user can switch on in Site settings; the toast points there for these. */
const SITE_SETTING_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'geolocation', 'geolocation-approximate', 'notifications', 'clipboard-read'])

/** Short toast for a denied permission request, e.g. "Clipboard blocked on github.com · allow in Site settings". */
export function permissionDeniedMessage(permission: string, origin: string): string {
  const label = PERMISSION_LABELS[permission] ?? permission
  // Extension pages have no Site settings row; for Bramble's Scan QR the usual cause is macOS camera access.
  if (origin.startsWith('chrome-extension:')) {
    return permission === 'media' ? `${label} blocked for this extension · check System Settings → Privacy & Security → Camera` : `${label} blocked for this extension`
  }
  let host = origin
  try {
    host = new URL(origin).host || origin
  } catch {
    // Keep the raw origin.
  }
  const where = host ? ` on ${host}` : ''
  return SITE_SETTING_PERMISSIONS.has(permission)
    ? `${label} blocked${where} · allow in Site settings`
    : `${label} blocked${where}`
}

/** One toast per origin+permission per window, so a site asking on every load doesn't spam. */
export function createPermissionToastThrottle(windowMs = 60_000, now: () => number = Date.now): (permission: string, origin: string) => boolean {
  const lastShown = new Map<string, number>()
  return (permission, origin) => {
    const key = `${origin}\n${permission}`
    const time = now()
    const last = lastShown.get(key)
    if (last !== undefined && time - last < windowMs) return false
    lastShown.set(key, time)
    if (lastShown.size > 200) lastShown.delete(lastShown.keys().next().value as string)
    return true
  }
}
