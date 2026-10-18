import type { WebContents, WebFrameMain } from 'electron'
import { connect } from 'node:net'
import { CastBrowser } from './cast-discovery'
import { readUserJson, writeUserJson } from './user-json'
import {
  CAST_DEVICES_FILE,
  knownCastDevicesChanged,
  parseKnownCastDevices,
  rememberCastDevices,
  serializeKnownCastDevices,
  type KnownCastDevice
} from '../shared/cast-known-devices'
import { CastClient } from './cast-client'
import { MirrorSession } from './cast-mirror'
import { MIRRORING_APP_ID } from '../shared/cast-streaming'
import {
  DEFAULT_MEDIA_RECEIVER_APP_ID,
  NS_MEDIA,
  buildLoadMessage,
  parseMediaStatus,
  type CastApplication,
  type CastMessage,
  type CastReceiverStatus
} from '../shared/cast-protocol'
import {
  castStatusFromPlayer,
  chooseCastMedia,
  castPosition,
  mergeCastDevices,
  type CastDevice,
  type CastMediaChoice,
  type CastSessionState,
  type CastSnapshot,
  type NetworkMediaHit,
  type PageMediaElement,
  type PageMediaProbe
} from '../shared/cast'

/**
 * Cast session manager (lazy chunk; src/main/cast-entry.ts is what loads at startup). Owns the mDNS
 * browser, at most one live cast (one CASTV2 connection), and the probe that finds a tab's media.
 *
 * "Cast video": the Default Media Receiver is launched and LOADs the page's media URL at the local
 * position; the local element is paused. Play/pause/seek go to the media session, volume to the
 * device. Stopping (here, on the TV or from another phone) ends the session; the local element is
 * left at the cast's position.
 */

export interface CastHost {
  emit: (snapshot: CastSnapshot) => void
  tabContents: (tabId: string) => WebContents | null
  networkHits: (contents: WebContents) => NetworkMediaHit[]
  enabled: () => boolean
}

/** Runs in each frame: the page's <video>/<audio> elements (read only; nothing is exposed to the page). */
const PROBE_SCRIPT = `(() => {
  const out = []
  for (const element of Array.from(document.querySelectorAll('video, audio')).slice(0, 24)) {
    const rect = element.getBoundingClientRect()
    const source = element.querySelector('source[src]')
    out.push({
      kind: element.tagName === 'VIDEO' ? 'video' : 'audio',
      src: String(element.currentSrc || element.src || (source ? source.src : '') || ''),
      currentTime: Number(element.currentTime) || 0,
      duration: Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null,
      paused: Boolean(element.paused),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      poster: String(element.poster || ''),
      visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
    })
  }
  return out
})()`

const ISOLATED_WORLD_ID = 1017
/** A known Chromecast on the LAN accepts a TCP connect in a few ms; past this it's gone or elsewhere. */
const VERIFY_TIMEOUT_MS = 300
const DEBUG = process.env.SURFFISH_CAST_DEBUG === '1'

/** True when host:port accepts a TCP connection within the timeout (the CASTV2 port; no TLS handshake). */
function reachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port })
    const finish = (ok: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      done(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

interface ProbedElement { frame: WebFrameMain; index: number }

interface LiveCast {
  client: CastClient
  device: CastDevice
  app: CastApplication | null
  mediaSessionId: number | null
  state: CastSessionState
  local: ProbedElement | null
  poll: ReturnType<typeof setInterval> | null
  /** Mirror tab: the Cast Streaming session (cast-mirror.ts). */
  mirror?: MirrorSession | null
}

function cleanElement(raw: unknown): PageMediaElement | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const num = (input: unknown): number => (typeof input === 'number' && Number.isFinite(input) ? input : 0)
  return {
    kind: value.kind === 'audio' ? 'audio' : 'video',
    src: typeof value.src === 'string' ? value.src.slice(0, 4096) : '',
    currentTime: num(value.currentTime),
    duration: typeof value.duration === 'number' && Number.isFinite(value.duration) ? value.duration : null,
    paused: value.paused !== false,
    width: num(value.width),
    height: num(value.height),
    poster: typeof value.poster === 'string' ? value.poster.slice(0, 4096) : '',
    visible: value.visible === true
  }
}

export class CastManager {
  private devices: CastDevice[] = []
  private browser = new CastBrowser((found) => {
    this.devices = mergeCastDevices(this.devices, found)
    this.remember(found)
    this.publish()
  })
  private known: KnownCastDevice[] | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private savedKnown: KnownCastDevice[] = []
  private verifying = false
  private pickerOpen = false
  private scanTimer: ReturnType<typeof setTimeout> | null = null
  private live: LiveCast | null = null
  private publishTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly host: CastHost) {}

  snapshot(): CastSnapshot {
    return {
      enabled: this.host.enabled(),
      scanning: this.browser.running,
      devices: this.devices.map((device) => ({ ...device })),
      session: this.live ? { ...this.live.state } : null
    }
  }

  private publish(): void {
    if (this.publishTimer) return
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null
      this.host.emit(this.snapshot())
    }, 60)
  }

  private updateBrowsing(): void {
    const want = this.host.enabled() && (this.pickerOpen || this.scanTimer !== null)
    if (want && !this.browser.running) {
      this.browser.start()
      void this.showKnownDevices()
    } else if (!want && this.browser.running) this.browser.stop()
    this.browser.setSystemResolver(want && this.pickerOpen)
    this.publish()
  }

  private loadKnown(): KnownCastDevice[] {
    if (!this.known) {
      this.known = parseKnownCastDevices(readUserJson(CAST_DEVICES_FILE), Date.now())
      this.savedKnown = this.known
    }
    return this.known
  }

  /**
   * Devices seen before show up as soon as a quick connect to their CASTV2 port answers (a few ms on
   * the LAN), without waiting for mDNS; ones that don't answer stay hidden until mDNS finds them.
   */
  private async showKnownDevices(): Promise<void> {
    if (this.verifying) return
    const candidates = this.loadKnown().filter((known) => !this.devices.some((device) => device.id === known.id))
    if (candidates.length === 0) return
    this.verifying = true
    const started = Date.now()
    try {
      await Promise.all(candidates.map(async (known) => {
        const ok = await reachable(known.host, known.port, VERIFY_TIMEOUT_MS)
        if (DEBUG) console.log(`[cast-debug] known ${known.name} ${known.host}:${known.port} ${ok ? 'reachable' : 'not reachable'} after ${Date.now() - started}ms`)
        if (!ok || !this.browser.running || this.devices.some((device) => device.id === known.id)) return
        this.devices = mergeCastDevices(this.devices, [{ id: known.id, name: known.name, model: known.model, host: known.host, port: known.port }])
        this.publish()
      }))
    } finally {
      this.verifying = false
    }
  }

  private remember(found: readonly CastDevice[]): void {
    this.known = rememberCastDevices(this.loadKnown(), found, Date.now())
    if (this.saveTimer || !knownCastDevicesChanged(this.savedKnown, this.known)) return
    this.saveTimer = setTimeout(() => this.saveKnown(), 1_500)
    this.saveTimer.unref?.()
  }

  private saveKnown(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.known || !knownCastDevicesChanged(this.savedKnown, this.known)) return
    if (writeUserJson(CAST_DEVICES_FILE, serializeKnownCastDevices(this.known))) this.savedKnown = this.known
  }

  /** The picker opened (browse until it closes) or closed. */
  setPickerOpen(open: boolean): void {
    this.pickerOpen = open
    if (open && this.browser.running) {
      this.browser.refresh()
      void this.showKnownDevices()
    }
    this.updateBrowsing()
  }

  /** A short browse (startup, window focus) so the toolbar knows whether there is anything to cast to. */
  scanBriefly(durationMs = 4_000): void {
    if (!this.host.enabled()) return
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      this.updateBrowsing()
    }, durationMs)
    this.scanTimer.unref?.()
    this.updateBrowsing()
  }

  /** The tab's media and whether its requests normally go through a proxy. */
  async probe(contents: WebContents): Promise<{ probe: PageMediaProbe; choice: CastMediaChoice; frames: ProbedElement[] }> {
    const elements: PageMediaElement[] = []
    const frames: ProbedElement[] = []
    const collect = (raw: unknown, frame: WebFrameMain): void => {
      if (!Array.isArray(raw)) return
      raw.forEach((item, index) => {
        const element = cleanElement(item)
        if (!element) return
        elements.push(element)
        frames.push({ frame, index })
      })
    }
    try {
      collect(await contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: PROBE_SCRIPT }]), contents.mainFrame)
    } catch { /* page navigating */ }
    // Embedded players (an iframe'd video) live in subframes.
    const subframes = contents.mainFrame.framesInSubtree.filter((frame) => frame !== contents.mainFrame && !frame.detached).slice(0, 12)
    await Promise.all(subframes.map(async (frame) => {
      try { collect(await frame.executeJavaScript(PROBE_SCRIPT), frame) } catch { /* cross-process frame gone */ }
    }))
    const probe: PageMediaProbe = { pageUrl: contents.getURL(), title: contents.getTitle(), elements, network: this.host.networkHits(contents) }
    return { probe, choice: chooseCastMedia(probe), frames }
  }

  private setState(patch: Partial<CastSessionState>): void {
    if (!this.live) return
    this.live.state = { ...this.live.state, ...patch }
    this.publish()
  }

  private async connectTo(device: CastDevice): Promise<CastClient> {
    const client = new CastClient(device.host, device.port)
    try {
      await client.open()
    } catch (error) {
      // A device that refuses connections has gone (or moved); drop it until the next browse.
      this.devices = this.devices.filter((candidate) => candidate.id !== device.id)
      this.publish()
      throw error
    }
    return client
  }

  async castMedia(deviceId: string, tabId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const device = this.devices.find((candidate) => candidate.id === deviceId)
    if (!device) return { ok: false, error: 'That Chromecast isn’t on the network any more.' }
    const contents = this.host.tabContents(tabId)
    if (!contents) return { ok: false, error: 'The tab isn’t loaded.' }
    const { choice, frames } = await this.probe(contents)
    if (!choice.castable) return { ok: false, error: choice.message }
    await this.stop()
    let client: CastClient
    const state: CastSessionState = {
      deviceId: device.id, deviceName: device.name, tabId, kind: 'media', title: choice.title, status: 'connecting',
      currentTime: choice.startTime, duration: null, live: choice.live, updatedAt: Date.now(), volume: null, muted: false, error: null
    }
    const live: LiveCast = { client: null as unknown as CastClient, device, app: null, mediaSessionId: null, state, local: choice.elementIndex >= 0 ? frames[choice.elementIndex] ?? null : null, poll: null }
    this.live = live
    this.publish()
    try {
      client = await this.connectTo(device)
      live.client = client
      if (this.live !== live) {
        client.close()
        return { ok: false, error: 'Cancelled.' }
      }
      client.on('message', (message: CastMessage, json: Record<string, unknown> | null) => this.onMessage(live, message, json))
      client.on('receiver-status', (status: CastReceiverStatus) => this.onReceiverStatus(live, status))
      client.on('close', (reason: string) => {
        // A failed cast keeps its error on screen for a moment (the timer below ends it).
        if (this.live !== live || live.state.status === 'error') return
        this.end(live, `Disconnected: ${reason}`)
      })
      this.setState({ status: 'loading' })
      const app = await client.launch(DEFAULT_MEDIA_RECEIVER_APP_ID)
      live.app = app
      const reply = await client.request(app.transportId, NS_MEDIA, buildLoadMessage(0, choice))
      if (reply.type !== 'MEDIA_STATUS') {
        const detail = typeof reply.detailedErrorCode === 'number' ? ` (code ${reply.detailedErrorCode})` : ''
        throw new Error(`The Chromecast couldn’t play this video${detail}. It may need the site’s login or cookies: try Mirror tab.`)
      }
      this.onMessage(live, null, reply)
      await this.pauseLocal(live.local)
      live.poll = setInterval(() => {
        if (this.live === live && live.app && live.mediaSessionId !== null && live.state.status === 'playing') {
          client.send(live.app.transportId, NS_MEDIA, { type: 'GET_STATUS', mediaSessionId: live.mediaSessionId, requestId: 0 })
        }
      }, 10_000)
      live.poll.unref?.()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.live === live) {
        this.setState({ status: 'error', error: message })
        const failed = live
        setTimeout(() => { if (this.live === failed) this.end(failed, message) }, 8_000).unref?.()
        live.client?.close?.('load failed')
      }
      return { ok: false, error: message }
    }
  }

  /**
   * Mirror tab: streams the tab itself (picture and sound) to the Chromecast's mirroring receiver,
   * for pages "Cast video" can't hand over (MSE players, logins, localhost).
   */
  async mirrorTab(deviceId: string, tabId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const device = this.devices.find((candidate) => candidate.id === deviceId)
    if (!device) return { ok: false, error: 'That Chromecast isn’t on the network any more.' }
    const contents = this.host.tabContents(tabId)
    if (!contents) return { ok: false, error: 'The tab isn’t loaded.' }
    await this.stop()
    const state: CastSessionState = {
      deviceId: device.id, deviceName: device.name, tabId, kind: 'mirror', title: contents.getTitle() || contents.getURL(), status: 'connecting',
      currentTime: 0, duration: null, live: true, updatedAt: Date.now(), volume: null, muted: false, error: null, mirror: null
    }
    const live: LiveCast = { client: null as unknown as CastClient, device, app: null, mediaSessionId: null, state, local: null, poll: null, mirror: null }
    this.live = live
    this.publish()
    try {
      const client = await this.connectTo(device)
      live.client = client
      if (this.live !== live) {
        client.close()
        return { ok: false, error: 'Cancelled.' }
      }
      client.on('receiver-status', (status: CastReceiverStatus) => this.onReceiverStatus(live, status))
      client.on('close', (reason: string) => {
        if (this.live !== live || live.state.status === 'error') return
        this.end(live, `Disconnected: ${reason}`)
      })
      this.setState({ status: 'loading' })
      const app = await client.launch(MIRRORING_APP_ID)
      live.app = app
      if (this.live !== live) return { ok: false, error: 'Cancelled.' }
      const mirror = new MirrorSession(client, device.host, contents, {
        onLive: () => { if (this.live === live) this.setState({ status: 'playing', updatedAt: Date.now() }) },
        onStats: (stats) => { if (this.live === live) this.setState({ mirror: stats }) },
        onError: (message) => {
          if (this.live !== live) return
          console.warn('[cast] mirroring failed:', message)
          void this.stop()
        }
      })
      live.mirror = mirror
      await mirror.start(app.transportId)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.live === live) {
        live.mirror?.stop()
        this.setState({ status: 'error', error: message })
        const failed = live
        setTimeout(() => { if (this.live === failed) void this.stop() }, 8_000).unref?.()
      }
      return { ok: false, error: message }
    }
  }

  private async pauseLocal(target: ProbedElement | null): Promise<void> {
    if (!target || target.frame.detached) return
    try {
      await target.frame.executeJavaScript(`(() => { const el = document.querySelectorAll('video, audio')[${target.index}]; if (el) el.pause() })()`)
    } catch { /* frame gone */ }
  }

  private async seekLocal(target: ProbedElement | null, seconds: number): Promise<void> {
    if (!target || target.frame.detached || !Number.isFinite(seconds)) return
    try {
      await target.frame.executeJavaScript(`(() => { const el = document.querySelectorAll('video, audio')[${target.index}]; if (el && Number.isFinite(el.duration)) el.currentTime = ${seconds.toFixed(3)} })()`)
    } catch { /* frame gone */ }
  }

  private onMessage(live: LiveCast, message: CastMessage | null, json: Record<string, unknown> | null): void {
    if (this.live !== live || !json) return
    if (message && message.namespace !== NS_MEDIA) return
    const status = parseMediaStatus(json)
    if (!status) return
    live.mediaSessionId = status.mediaSessionId
    const next = castStatusFromPlayer(status.playerState, status.idleReason)
    // IDLE right after LOAD (before PLAYING) is normal; only FINISHED/ERROR end the session.
    this.setState({
      status: next === 'idle' && live.state.status === 'loading' ? 'loading' : next,
      currentTime: status.currentTime,
      duration: status.duration ?? live.state.duration,
      live: status.live || live.state.live,
      updatedAt: Date.now(),
      error: next === 'error' ? 'The Chromecast stopped with a playback error. The site may need its login or cookies: try Mirror tab.' : null
    })
    if (next === 'ended') {
      setTimeout(() => { if (this.live === live) void this.stop() }, 3_000).unref?.()
    }
  }

  private onReceiverStatus(live: LiveCast, status: CastReceiverStatus): void {
    if (this.live !== live) return
    if (status.volume.level !== null || status.volume.muted !== null) {
      this.setState({ volume: status.volume.level ?? live.state.volume, muted: status.volume.muted ?? live.state.muted })
    }
    // Someone else (another phone, the TV remote, Google Home) replaced or stopped our player.
    if (live.app && !status.applications.some((app) => app.sessionId === live.app!.sessionId)) {
      this.end(live, null)
    }
  }

  async control(action: string, value?: number): Promise<boolean> {
    const live = this.live
    if (!live?.client?.isOpen) return false
    const transport = live.app?.transportId
    const session = live.mediaSessionId
    if (action === 'volume' && typeof value === 'number') {
      live.client.setVolume({ level: Math.min(1, Math.max(0, value)) })
      this.setState({ volume: Math.min(1, Math.max(0, value)) })
      return true
    }
    if (action === 'mute') {
      live.client.setVolume({ muted: !live.state.muted })
      this.setState({ muted: !live.state.muted })
      return true
    }
    if (!transport || session === null) return false
    if (action === 'play' || action === 'pause') {
      live.client.send(transport, NS_MEDIA, { type: action === 'play' ? 'PLAY' : 'PAUSE', mediaSessionId: session, requestId: 0 })
      this.setState({ status: action === 'play' ? 'playing' : 'paused', currentTime: castPosition(live.state), updatedAt: Date.now() })
      return true
    }
    if (action === 'seek' && typeof value === 'number' && Number.isFinite(value)) {
      const target = Math.max(0, live.state.duration !== null ? Math.min(value, live.state.duration) : value)
      live.client.send(transport, NS_MEDIA, { type: 'SEEK', mediaSessionId: session, currentTime: target, resumeState: 'PLAYBACK_START', requestId: 0 })
      this.setState({ currentTime: target, updatedAt: Date.now() })
      return true
    }
    return false
  }

  /** Stops the player on the TV and leaves the local video where the cast was. */
  async stop(): Promise<void> {
    const live = this.live
    if (!live) return
    const position = live.state.live ? null : castPosition(live.state)
    if (live.client?.isOpen && live.app) {
      if (live.mediaSessionId !== null) live.client.send(live.app.transportId, NS_MEDIA, { type: 'STOP', mediaSessionId: live.mediaSessionId, requestId: 0 })
      live.client.stopApp(live.app.sessionId)
    }
    this.end(live, null)
    if (position !== null) await this.seekLocal(live.local, position)
  }

  private end(live: LiveCast, error: string | null): void {
    if (this.live !== live) return
    if (live.poll) clearInterval(live.poll)
    live.mirror?.stop()
    this.live = null
    if (error) console.warn('[cast] session ended:', error)
    setTimeout(() => live.client?.close?.('stopped'), 200).unref?.()
    this.publish()
  }

  /** Settings turned casting off, or the app is quitting. */
  shutdown(): void {
    void this.stop()
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = null
    this.pickerOpen = false
    this.browser.stop()
    this.saveKnown()
    this.publish()
  }

  activeTabId(): string | null {
    return this.live?.state.tabId ?? null
  }
}
