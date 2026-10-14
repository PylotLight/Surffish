/**
 * Shared, Electron-free pieces of Surffish's Bramble quick unlock: the settings state shape, the
 * unlock-screen detection (a page script + a pure classifier) and the fill script.
 *
 * Detection never patches Bramble. Surffish reads Bramble's unlock form from an isolated world:
 * a form holding exactly one `masterPassword` input (Bramble's Auth screen, react-hook-form
 * `register("masterPassword")`) with no second password field anywhere on the page, which is what
 * tells it apart from vault setup / change password (they have a confirm field).
 */

export const QUICK_UNLOCK_PIN_PATTERN = /^[0-9]{4,8}$/
export const QUICK_UNLOCK_MAX_ATTEMPTS = 5

/** What Settings shows. Never carries secrets. */
export interface BrambleQuickUnlockState {
  /** The user turned quick unlock on (a PIN exists or existed this session). */
  enabled: boolean
  /** A wrapped secret is available right now (false after a restart in memory-only mode). */
  armed: boolean
  /** Not armed, but typing the master password into Surffish's prompt re-arms it. */
  canRearm: boolean
  touchIdEnabled: boolean
  /** Running on a Mac that can prompt for Touch ID. */
  touchIdAvailable: boolean
  /** "Require master password after Surffish restarts" (memory-only). */
  requireMasterAfterRestart: boolean
  /** safeStorage can protect the device key (needed to persist across restarts). */
  persistAvailable: boolean
  failedAttempts: number
  maxAttempts: number
  /** Last thing that happened worth telling the user (reset after lockout, master changed, …). */
  notice: string | null
}

export interface BrambleQuickUnlockEnrolInput {
  masterPassword: string
  pin: string
  confirmPin: string
  touchId: boolean
  requireMasterAfterRestart: boolean
}

export type QuickUnlockResult = { ok: true; state: BrambleQuickUnlockState } | { ok: false; error: string; state: BrambleQuickUnlockState }

export function quickUnlockPinError(pin: string, confirmPin: string): string | null {
  if (!QUICK_UNLOCK_PIN_PATTERN.test(pin)) return 'Use a PIN of 4 to 8 digits.'
  if (pin !== confirmPin) return 'The PINs do not match.'
  return null
}

// ---------------------------------------------------------------------------
// Unlock screen detection

export interface UnlockFieldSnapshot {
  name: string
  type: string
  visible: boolean
  disabled: boolean
  readOnly: boolean
  inForm: boolean
  /** Password-like inputs inside the same form. */
  formPasswordInputs: number
  hasSubmit: boolean
  /** aria-invalid="true": Bramble shows an error under the field (e.g. wrong password). */
  invalid: boolean
  /** Submit button disabled: Bramble is busy unlocking. */
  busy: boolean
}

export interface UnlockPageSnapshot {
  href: string
  /** Password-like inputs (type=password or name=masterPassword) anywhere on the page. */
  passwordInputs: number
  field: UnlockFieldSnapshot | null
}

export type UnlockScreenKind = 'unlock' | 'other'

const BRAMBLE_UI_PAGES = new Set(['/popup.html', '/options.html'])

/** True for Bramble's own popup / options page on its loaded extension origin. */
export function isBrambleUnlockPageUrl(href: string, extensionUrl: string): boolean {
  try {
    const page = new URL(href)
    const extension = new URL(extensionUrl)
    return page.protocol === 'chrome-extension:' && extension.protocol === 'chrome-extension:' &&
      page.host === extension.host && !page.username && !page.password && !page.port && BRAMBLE_UI_PAGES.has(page.pathname)
  } catch {
    return false
  }
}

/** Pure decision on a page snapshot: is this Bramble's master-password unlock screen, fillable now? */
export function classifyBrambleUnlockScreen(snapshot: unknown, extensionUrl: string): UnlockScreenKind {
  if (typeof snapshot !== 'object' || snapshot === null) return 'other'
  const page = snapshot as Partial<UnlockPageSnapshot>
  if (typeof page.href !== 'string' || !isBrambleUnlockPageUrl(page.href, extensionUrl)) return 'other'
  const field = page.field
  if (!field || typeof field !== 'object') return 'other'
  if (field.name !== 'masterPassword' || (field.type !== 'password' && field.type !== 'text')) return 'other'
  if (!field.visible || field.disabled || field.readOnly || !field.inForm || !field.hasSubmit) return 'other'
  // Setup and change-password screens carry a confirm field; only the unlock form has exactly one.
  if (field.formPasswordInputs !== 1 || page.passwordInputs !== 1) return 'other'
  return 'unlock'
}

export type FillOutcome = 'unlocked' | 'rejected' | 'pending'

/** After a fill: the form went away (unlocked), Bramble flagged the field (rejected), or still working. */
export function classifyFillOutcome(snapshot: unknown, extensionUrl: string): FillOutcome {
  if (typeof snapshot !== 'object' || snapshot === null) return 'pending'
  const page = snapshot as Partial<UnlockPageSnapshot>
  if (typeof page.href !== 'string' || !isBrambleUnlockPageUrl(page.href, extensionUrl)) return 'pending'
  const field = page.field
  if (!field || field.name !== 'masterPassword' || page.passwordInputs === 0) return 'unlocked'
  if (field.invalid && !field.busy) return 'rejected'
  return 'pending'
}

/**
 * Runs in an isolated world of the Bramble page and returns an UnlockPageSnapshot. Read-only.
 * Kept as source text so it is exactly what the page runs (no bundler rewriting).
 */
export const UNLOCK_SNAPSHOT_SCRIPT = `(() => {
  const PASSWORD_SELECTOR = 'input[type="password"], input[name="masterPassword"]';
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const all = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).filter(visible);
  const input = all.find((element) => element.name === 'masterPassword') || null;
  let field = null;
  if (input) {
    const form = input.form;
    const formInputs = form ? Array.from(form.querySelectorAll(PASSWORD_SELECTOR)).filter(visible) : [];
    const submit = form ? form.querySelector('button[type="submit"], input[type="submit"]') : null;
    field = {
      name: input.name,
      type: input.type,
      visible: true,
      disabled: input.disabled,
      readOnly: input.readOnly,
      inForm: !!form,
      formPasswordInputs: formInputs.length,
      hasSubmit: !!submit,
      invalid: input.getAttribute('aria-invalid') === 'true',
      busy: !!(submit && submit.disabled)
    };
  }
  return { href: location.href, passwordInputs: all.length, field };
})()`

/**
 * Fill Bramble's master password field and submit its form, from an isolated world. Setting the
 * value through the native setter from another world bypasses React's value tracker, so the
 * dispatched input event is seen as a real change by react-hook-form. Returns true when submitted.
 */
export function buildUnlockFillScript(secret: string): string {
  return `(() => {
  const secret = ${JSON.stringify(secret)};
  const input = Array.from(document.querySelectorAll('input[name="masterPassword"]')).find((element) => element.isConnected && element.form);
  if (!input || input.disabled || input.readOnly) return false;
  const form = input.form;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, secret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  if (submit && submit.disabled) return false;
  if (typeof form.requestSubmit === 'function') form.requestSubmit(submit || undefined);
  else if (submit) submit.click();
  else return false;
  return true;
})()`
}
