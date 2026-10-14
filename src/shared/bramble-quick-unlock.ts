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
  /** Not armed, but unlocking once with the master password in Bramble's own form re-arms it. */
  canRearm: boolean
  /** That re-arm also moves an older memory-only setup to "PIN keeps working after restarts". */
  migratesOnRearm: boolean
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
  /**
   * Whether Bramble has a vault to unlock (read from its extension storage). Setup is only offered
   * when 'present'; 'unknown' means Bramble is not loaded or its storage could not be read.
   */
  vault: BrambleVaultStatus
}

export interface BrambleQuickUnlockEnrolInput {
  masterPassword: string
  pin: string
  confirmPin: string
  touchId: boolean
  /** Omitted: persisted (PIN survives restarts) when secure key storage exists, memory-only otherwise. */
  requireMasterAfterRestart?: boolean
}

/** Settings toggle after setup. Turning memory-only on needs the current PIN. */
export interface BrambleQuickUnlockRequireMasterInput {
  require: boolean
  pin?: string
}

export type QuickUnlockResult = { ok: true; state: BrambleQuickUnlockState } | { ok: false; error: string; state: BrambleQuickUnlockState }

export const QUICK_UNLOCK_NEEDS_VAULT = 'Create your Bramble vault first.'

// ---------------------------------------------------------------------------
// Does Bramble have a vault?
//
// Bramble 1.29 keeps everything in chrome.storage.local: `vault.registry` is `{ vaults: [{ id,
// label, createdAt }] }`, and each vault's encrypted blob is a base64 string under
// `vault-blob-b64:<id>` (pre-registry builds used a bare `vault-blob-b64`, which Bramble migrates
// on first run). A registry entry alone is not a vault: Bramble registers the id just before it
// writes the blob, and prunes ids that never got one. So a vault exists when one registered id (or
// the legacy key) has a non-empty blob, the same thing Bramble's own unlock screen needs.

export type BrambleVaultStatus = 'present' | 'absent' | 'unknown'

export const BRAMBLE_VAULT_REGISTRY_KEY = 'vault.registry'
export const BRAMBLE_VAULT_BLOB_KEY = 'vault-blob-b64'

/** What the probe script returns: registered vault ids and which blob keys hold data. Never blob contents. */
export interface BrambleVaultProbe {
  vaultIds: string[]
  blobs: Record<string, boolean>
}

/**
 * Runs in one of Bramble's own extension pages (its offscreen document) and returns a
 * BrambleVaultProbe, or null when there is no extension storage. Read-only; only booleans leave.
 */
export const BRAMBLE_VAULT_PROBE_SCRIPT = `(() => {
  const api = globalThis.chrome && globalThis.chrome.storage ? globalThis.chrome : globalThis.browser;
  const local = api && api.storage && api.storage.local;
  if (!local) return Promise.resolve(null);
  const get = (keys) => new Promise((resolve, reject) => {
    try {
      const pending = local.get(keys, (items) => {
        const error = api.runtime && api.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve(items || {});
      });
      if (pending && typeof pending.then === 'function') pending.then((items) => resolve(items || {}), reject);
    } catch (error) { reject(error); }
  });
  return get(${JSON.stringify(BRAMBLE_VAULT_REGISTRY_KEY)}).then((items) => {
    const registry = items[${JSON.stringify(BRAMBLE_VAULT_REGISTRY_KEY)}];
    const vaults = registry && Array.isArray(registry.vaults) ? registry.vaults : [];
    const vaultIds = vaults.map((vault) => vault && vault.id).filter((id) => typeof id === 'string' && id.length > 0);
    const keys = [${JSON.stringify(BRAMBLE_VAULT_BLOB_KEY)}].concat(vaultIds.map((id) => ${JSON.stringify(BRAMBLE_VAULT_BLOB_KEY)} + ':' + id));
    return get(keys).then((blobs) => {
      const present = {};
      for (const key of keys) present[key] = typeof blobs[key] === 'string' && blobs[key].length > 0;
      return { vaultIds, blobs: present };
    });
  });
})()`

/** Pure decision on a probe result. Anything malformed is 'unknown', never 'present'. */
export function classifyBrambleVaultProbe(probe: unknown): BrambleVaultStatus {
  if (typeof probe !== 'object' || probe === null) return 'unknown'
  const { vaultIds, blobs } = probe as Partial<BrambleVaultProbe>
  if (!Array.isArray(vaultIds) || typeof blobs !== 'object' || blobs === null) return 'unknown'
  if (blobs[BRAMBLE_VAULT_BLOB_KEY] === true) return 'present'
  for (const id of vaultIds) {
    if (typeof id === 'string' && id && blobs[`${BRAMBLE_VAULT_BLOB_KEY}:${id}`] === true) return 'present'
  }
  return 'absent'
}

export const QUICK_UNLOCK_VAULT_UNKNOWN = 'Surffish could not check Bramble’s vault. Make sure Bramble is loaded, then try again.'

/** Why PIN setup is not allowed right now (null when Bramble has a vault). Shared by Settings and the enrol IPC. */
export function quickUnlockSetupBlocker(vault: unknown): string | null {
  if (vault === 'present') return null
  return vault === 'absent' ? QUICK_UNLOCK_NEEDS_VAULT : QUICK_UNLOCK_VAULT_UNKNOWN
}

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

// ---------------------------------------------------------------------------
// Re-arming from Bramble's own form (memory-only mode after a restart)
//
// Surffish shows no master password screen of its own. When quick unlock is enabled but not armed,
// main installs a capture-phase submit listener in its isolated world of Bramble's popup (the
// same world the fill runs in; Bramble's own scripts cannot see it). It keeps only the last value
// submitted through a form with exactly one password field named masterPassword, i.e. the unlock
// form, never setup or change-password. Main takes (and clears) it, waits for Bramble to unlock
// with it, and the vault re-arms only if it opens the PIN-under-master slot.

const CAPTURE_STATE = '__surffishQuickUnlockCapture'

export const MASTER_CAPTURE_INSTALL_SCRIPT = `(() => {
  const state = globalThis.${CAPTURE_STATE} || (globalThis.${CAPTURE_STATE} = { value: null, active: false, installed: false });
  state.active = true;
  if (!state.installed) {
    state.installed = true;
    document.addEventListener('submit', (event) => {
      if (!state.active) return;
      const form = event.target;
      if (!form || typeof form.querySelectorAll !== 'function') return;
      const fields = form.querySelectorAll('input[type="password"], input[name="masterPassword"]');
      if (fields.length !== 1 || fields[0].name !== 'masterPassword') return;
      const value = fields[0].value;
      if (typeof value === 'string' && value) state.value = value;
    }, true);
  }
  return true;
})()`

/** Returns the last submitted value (or null) and forgets it. */
export const MASTER_CAPTURE_TAKE_SCRIPT = `(() => {
  const state = globalThis.${CAPTURE_STATE};
  if (!state || typeof state.value !== 'string') return null;
  const value = state.value;
  state.value = null;
  return value;
})()`

/** Stop collecting and forget anything collected (quick unlock armed again, or our own fill). */
export const MASTER_CAPTURE_STOP_SCRIPT = `(() => {
  const state = globalThis.${CAPTURE_STATE};
  if (state) { state.active = false; state.value = null; }
  return true;
})()`
