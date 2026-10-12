import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { getBrowserSession } from './browser-session'
import { fetchBrambleLogin, findBrambleLogins } from './bramble-poc'
import { getMainWindow } from './window'
import { helperFrameArgument, isBrambleFillHost, parseHelperMessage, toElectronCookie, type WebKitCookie } from './google-webkit-sign-in-policy.ts'

export type GoogleSignInResult = 'signed-in' | 'cancelled' | 'unavailable' | 'failed'

let running: Promise<GoogleSignInResult> | null = null

function helperPath(): string | null {
  if (process.platform !== 'darwin') return null
  const path = join(dirname(fileURLToPath(import.meta.url)), '../native/google-sign-in').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  return existsSync(path) ? path : null
}

export function isWebKitGoogleSignInAvailable(): boolean {
  return helperPath() !== null
}

/** Run the native WebKit sign-in window and import its Google cookies. */
export function runWebKitGoogleSignIn(continueUrl: string): Promise<GoogleSignInResult> {
  if (running) return running
  const path = helperPath()
  if (!path) return Promise.resolve('unavailable')
  running = new Promise<GoogleSignInResult>((resolve) => {
    const owner = getMainWindow()
    const frame = helperFrameArgument(owner && !owner.isDestroyed() ? owner.getBounds() : null)
    const child = spawn(path, frame ? [continueUrl, frame] : [continueUrl], { stdio: ['pipe', 'pipe', 'inherit'] })
    let cookies: WebKitCookie[] | null = null
    let lastListHost = ''
    const reply = (message: Record<string, unknown>) => {
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    child.stdin?.on('error', () => {})
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const message = parseHelperMessage(line)
      if (!message) return
      if (message.type === 'cookies') cookies = message.cookies
      else if (message.type === 'bramble-list') {
        if (!isBrambleFillHost(message.host)) return reply({ type: 'bramble-list', status: 'unavailable', logins: [] })
        lastListHost = message.host
        void findBrambleLogins(message.host).then((result) => reply({ type: 'bramble-list', logins: [], ...result }))
      } else if (message.type === 'bramble-fill') {
        if (!isBrambleFillHost(lastListHost)) return reply({ type: 'bramble-fill', status: 'unavailable' })
        void fetchBrambleLogin(lastListHost, message.id).then((secret) =>
          reply(secret ? { type: 'bramble-fill', status: 'ok', ...secret } : { type: 'bramble-fill', status: 'unavailable' }))
      }
    })
    child.on('error', (error) => {
      console.warn('[google sign-in] helper failed to start:', error)
      resolve('failed')
    })
    child.on('close', async (code) => {
      if (code !== 0) return resolve(code === 2 ? 'cancelled' : 'failed')
      try {
        if (!cookies) throw new Error('Google sign-in helper returned no cookie list.')
        const session = getBrowserSession()
        let imported = 0
        for (const cookie of cookies) {
          const details = toElectronCookie(cookie)
          if (!details) continue
          try {
            await session.cookies.set(details)
            imported += 1
          } catch (error) {
            console.warn(`[google sign-in] could not import cookie ${details.name}:`, error)
          }
        }
        await session.cookies.flushStore()
        const sid = await session.cookies.get({ url: 'https://www.google.com/', name: 'SID' })
        const youtube = cookies.filter((cookie) => cookie.domain.replace(/^\./, '').endsWith('youtube.com')).length
        console.log(`[google sign-in] imported ${imported} of ${cookies.length} cookies (${youtube} youtube); SID in session: ${sid.length > 0}`)
        resolve(imported > 0 && sid.length > 0 ? 'signed-in' : 'failed')
      } catch (error) {
        console.warn('[google sign-in] could not read helper output:', error)
        resolve('failed')
      }
    })
  }).finally(() => { running = null })
  return running
}
