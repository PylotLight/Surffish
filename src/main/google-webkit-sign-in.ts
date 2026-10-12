import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBrowserSession } from './browser-session'
import { parseHelperOutput, toElectronCookie } from './google-webkit-sign-in-policy.ts'

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
export function runWebKitGoogleSignIn(): Promise<GoogleSignInResult> {
  if (running) return running
  const path = helperPath()
  if (!path) return Promise.resolve('unavailable')
  running = new Promise<GoogleSignInResult>((resolve) => {
    const child = spawn(path, [], { stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.on('error', (error) => {
      console.warn('[google sign-in] helper failed to start:', error)
      resolve('failed')
    })
    child.on('close', async (code) => {
      if (code !== 0) return resolve(code === 2 ? 'cancelled' : 'failed')
      try {
        const cookies = parseHelperOutput(stdout)
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
        console.log(`[google sign-in] imported ${imported} of ${cookies.length} cookies`)
        resolve(imported > 0 ? 'signed-in' : 'failed')
      } catch (error) {
        console.warn('[google sign-in] could not read helper output:', error)
        resolve('failed')
      }
    })
  }).finally(() => { running = null })
  return running
}
