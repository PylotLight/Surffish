import { session } from 'electron'

export const BROWSER_SESSION_PARTITION = 'persist:fish-browser'

export function getBrowserSession(): Electron.Session {
  // The named persistent partition stores cookies and site storage in the app's
  // user-data profile and reuses it across development and packaged launches.
  return session.fromPartition(BROWSER_SESSION_PARTITION)
}
