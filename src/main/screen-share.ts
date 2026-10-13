import { BaseWindow, desktopCapturer, dialog, shell, systemPreferences } from 'electron'
import { onPageSessionCreated } from './browser-session'
import { buildScreenShareChoices, captureSourceKind } from '../shared/screen-share'

/**
 * Screen sharing for web pages (Meet, Zoom web, Discord, Slack huddles…): getDisplayMedia goes
 * through Electron's display-media handler, which Surffish never set, so every share failed.
 *
 * macOS 15+: the system picker (ScreenCaptureKit) is used, the same one Safari shows. It handles the
 * Screen Recording permission itself and our handler isn't called. Elsewhere, or if that picker isn't
 * available, a small chooser offers This tab / the screens / a few windows. The site's
 * `display-capture` permission request is allowed for secure origins (proxy.ts); the picker is the
 * consent, as in Chrome.
 */

const SCREEN_RECORDING_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

type DisplayMediaRequest = Parameters<Parameters<Electron.Session['setDisplayMediaRequestHandler']>[0] & object>[0]
type DisplayMediaCallback = Parameters<Parameters<Electron.Session['setDisplayMediaRequestHandler']>[0] & object>[1]

/** Electron's docs: `null` denies (the page gets an AbortError); its typings don't allow null yet. */
function deny(callback: DisplayMediaCallback): void {
  callback(null as unknown as Electron.Streams)
}

function parentWindow(): BaseWindow | undefined {
  return BaseWindow.getFocusedWindow() ?? BaseWindow.getAllWindows().find((window) => !window.isDestroyed())
}

async function screenRecordingBlocked(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status !== 'denied' && status !== 'restricted') return false
  const parent = parentWindow()
  const options = {
    type: 'warning' as const,
    message: 'Surffish needs Screen Recording permission to share your screen.',
    detail: 'Turn on Surffish in System Settings → Privacy & Security → Screen & System Audio Recording, then try again. You can still share just this tab.',
    buttons: ['Open System Settings', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  }
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (response === 0) void shell.openExternal(SCREEN_RECORDING_SETTINGS)
  return true
}

async function chooseSource(request: DisplayMediaRequest, callback: DisplayMediaCallback): Promise<void> {
  const frame = request.frame
  const canShareTab = Boolean(frame && frame === frame.top)
  let sources: Electron.DesktopCapturerSource[] = []
  const blocked = await screenRecordingBlocked()
  if (!blocked) {
    sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).catch(() => [])
  }
  const choices = buildScreenShareChoices(sources, { canShareTab, ownWindowNames: ['Surffish'] })
  if (choices.length === 0) {
    deny(callback)
    return
  }
  const parent = parentWindow()
  let host = request.securityOrigin
  try { host = new URL(request.securityOrigin).host || host } catch { /* keep the raw origin */ }
  const options = {
    type: 'question' as const,
    message: `Share with ${host}?`,
    detail: 'Choose what this site can see. You can stop sharing from the site at any time.',
    buttons: [...choices.map((choice) => choice.label), 'Cancel'],
    cancelId: choices.length,
    defaultId: 0,
    noLink: true
  }
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  const choice = choices[response]
  if (!choice) {
    deny(callback)
    return
  }
  try {
    if (choice.kind === 'tab' && frame) {
      // The tab's own video, plus its audio when the site asked for audio.
      callback({ video: frame, ...(request.audioRequested ? { audio: frame } : {}) })
      return
    }
    if (choice.kind === 'source') {
      const source = sources.find((candidate) => candidate.id === choice.source.id)
      if (!source) {
        deny(callback)
        return
      }
      // System audio loopback only exists on Windows.
      const audio = request.audioRequested && process.platform === 'win32' && captureSourceKind(source.id) === 'screen' ? 'loopback' : undefined
      callback({ video: source, ...(audio ? { audio } : {}) })
      return
    }
    deny(callback)
  } catch (error) {
    // The frame went away while the chooser was open.
    console.warn('Screen sharing request ended before a source was granted:', error)
    try { deny(callback) } catch { /* already answered */ }
  }
}

export function initializeScreenSharing(): Promise<void> {
  return onPageSessionCreated((target) => {
    target.setDisplayMediaRequestHandler((request, callback) => {
      void chooseSource(request, callback).catch((error: unknown) => {
        console.error('Screen sharing picker failed:', error)
        try { deny(callback) } catch { /* already answered */ }
      })
    }, { useSystemPicker: true })
  })
}
