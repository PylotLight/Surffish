import { session } from 'electron'
import { chromeUserAgent } from './adblock-policy.ts'

export const BROWSER_SESSION_PARTITION = 'persist:surffish-browser'

let userAgentApplied = false

export function getBrowserSession(): Electron.Session {
  // The named persistent partition stores cookies and site storage in the app's
  // user-data profile and reuses it across development and packaged launches.
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION)
  if (!userAgentApplied) {
    userAgentApplied = true
    // YouTube and Google serve different player/ad code paths to unknown
    // clients; uBO's YouTube fixes target real Chrome, so look like Chrome.
    browserSession.setUserAgent(chromeUserAgent(browserSession.getUserAgent()))
  }
  return browserSession
}
