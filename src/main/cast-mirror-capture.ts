import { BrowserWindow, type WebContents } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { holdPageViewForCapture } from './tab-visibility'

/**
 * The hidden capture page behind "Mirror tab": a never-shown window whose sandboxed preload
 * (src/preload/cast-capture.cjs) captures the tab through its media source id and encodes VP8 +
 * Opus with WebCodecs. Encoded frames come back here over the window's own IPC (not ipcMain), and
 * the tab is held for Chromium (hidden but attached, never slept) while it is captured.
 *
 * Tab audio capture turns off the tab's local playback (Chromium's tab capture runs with local
 * echo off), so the sound moves to the TV and comes back when mirroring stops.
 */

export interface CapturedFrame {
  kind: 'audio' | 'video'
  key: boolean
  /** Capture time on this machine's wall clock (ms). */
  captureMs: number
  data: Uint8Array
}

interface CaptureOptions {
  width: number
  height: number
  fps: number
  videoBitrate: number
  audioBitrate: number
  onFrame: (frame: CapturedFrame) => void
  onStatus: (kind: string, detail: string) => void
}

/** A file:// page is a secure context (getUserMedia needs one); its text never shows. */
function capturePage(): { preload: string; url: string } {
  const preload = join(dirname(fileURLToPath(import.meta.url)), '../preload/cast-capture.cjs')
  return { preload, url: pathToFileURL(preload).href }
}

export class TabCapture {
  private window: BrowserWindow | null = null
  private releaseHold: (() => void) | null = null
  private stopped = false

  constructor(private readonly tab: WebContents, private readonly options: CaptureOptions) {}

  async start(): Promise<void> {
    const { preload, url } = capturePage()
    const window = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      skipTaskbar: true,
      webPreferences: {
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        // In-memory and separate: none of the browser's permission prompts or site handlers.
        partition: 'surffish-cast-capture',
        spellcheck: false
      }
    })
    this.window = window
    const contents = window.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.session.setPermissionCheckHandler((_contents, permission) => permission === 'media')
    contents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'media'))
    contents.ipc.on('cast-capture:frame', (_event, frame: unknown) => {
      if (this.stopped || typeof frame !== 'object' || frame === null) return
      const value = frame as Record<string, unknown>
      if (!(value.data instanceof Uint8Array) || typeof value.captureMs !== 'number') return
      this.options.onFrame({ kind: value.kind === 'audio' ? 'audio' : 'video', key: value.key === true, captureMs: value.captureMs, data: value.data })
    })
    contents.ipc.on('cast-capture:status', (_event, status: unknown) => {
      if (this.stopped || typeof status !== 'object' || status === null) return
      const value = status as Record<string, unknown>
      this.options.onStatus(String(value.kind ?? ''), String(value.detail ?? ''))
    })
    contents.on('render-process-gone', () => { if (!this.stopped) this.options.onStatus('error', 'the capture page stopped') })
    await window.loadURL(url)
    if (this.stopped || this.tab.isDestroyed()) return
    this.releaseHold = holdPageViewForCapture(this.tab)
    const sourceId = this.tab.getMediaSourceId(contents)
    contents.send('cast-capture:start', {
      sourceId,
      width: this.options.width,
      height: this.options.height,
      fps: this.options.fps,
      videoBitrate: this.options.videoBitrate,
      audioBitrate: this.options.audioBitrate
    })
  }

  requestKeyFrame(): void {
    const contents = this.window?.webContents
    if (contents && !contents.isDestroyed()) contents.send('cast-capture:key-frame')
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const window = this.window
    this.window = null
    if (window && !window.isDestroyed()) {
      try { window.webContents.send('cast-capture:stop') } catch { /* closing */ }
      // Let the tracks stop (and the tab's local audio come back) before the page goes.
      setTimeout(() => { if (!window.isDestroyed()) window.destroy() }, 300).unref?.()
    }
    this.releaseHold?.()
    this.releaseHold = null
  }
}
