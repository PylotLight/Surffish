import type { BrowserWindow } from 'electron'

/** Shared type-only contracts between the main, preload, and renderer processes. */
export type VibrancyName = NonNullable<Parameters<BrowserWindow['setVibrancy']>[0]>

export interface SysInfo {
  platform: NodeJS.Platform
  arch: string
  release: string
  hostname: string
  cpus: number
  totalMem: number
  freeMem: number
}

export interface GlassState {
  platform: NodeJS.Platform
  vibrancy: VibrancyName | null
  transparent: boolean
}

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
