// Single source of truth for app identity and window defaults.
export const APP_NAME = 'Fish Browser'
export const APP_TAGLINE = 'a small browser · local SOCKS5'
export const APP_ID = 'com.pylotlight.fishbrowser'
export const WINDOW = {
  width: 1240,
  height: 820,
  minWidth: 980,
  minHeight: 640
} as const
export const TRAY_TOOLTIP = `${APP_NAME} — click for menu`
