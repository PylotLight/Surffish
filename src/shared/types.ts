/** Shared type-only contracts between the main, preload, and renderer processes. */
export interface BrowserProxySettings {
  enabled: boolean
  host: string
  port: number
}
export interface BrowserProxyTestResult {
  reachable: boolean
  message: string
}
export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}
