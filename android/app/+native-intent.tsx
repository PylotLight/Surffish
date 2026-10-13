/**
 * Android hands us http(s) links (we're registered as a browser) and shared text. Those are
 * pages to open, not app routes: the native module picks them up (onIntent / consumeLaunchIntent),
 * so expo-router always stays on the browser screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (/^(https?:|surffish:)/i.test(path) || path.includes('://')) return '/'
  return path || '/'
}
