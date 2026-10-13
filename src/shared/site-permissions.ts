/**
 * Permissions Chrome grants without a prompt. Blink still gates each on its own rules (a user
 * gesture and a focused page for clipboard writes and fullscreen), so allowing them here only stops
 * our deny-by-default site policy from breaking ordinary pages: GitHub's copy buttons, YouTube's
 * fullscreen button, and so on. Reading the clipboard stays denied (Chrome prompts for that).
 */
const ALWAYS_ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen'])

export function isAlwaysAllowedPermission(permission: string): boolean {
  return ALWAYS_ALLOWED_PERMISSIONS.has(permission)
}
