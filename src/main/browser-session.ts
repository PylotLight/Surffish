import { session } from 'electron'

export const BROWSER_SESSION_PARTITION = 'persist:fish-browser'

export function getBrowserSession(): Electron.Session {
  return session.fromPartition(BROWSER_SESSION_PARTITION)
}
