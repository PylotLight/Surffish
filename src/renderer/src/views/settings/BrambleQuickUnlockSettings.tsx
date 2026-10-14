import { useEffect, useState } from 'react'
import { quickUnlockPinError, quickUnlockSetupBlocker, type BrambleQuickUnlockState } from '../../../../shared/bramble-quick-unlock'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/**
 * Settings → Integrations → Bramble → Quick unlock. Surffish-only: a PIN (and Touch ID on a Mac)
 * that unlocks Bramble's popup by typing the master password for you. Setup asks for the master
 * password once, here, in Surffish's own form. Setup is only offered once Bramble has a vault.
 *
 * By default the PIN keeps working after Surffish restarts (key in the system keychain). "Require
 * master password after Surffish restarts" can be switched here at any time: off needs quick unlock
 * armed right now, on needs the PIN.
 */

/** While Bramble has no vault, re-check this often so the section unlocks as soon as one is created. */
const VAULT_RECHECK_MS = 2000
export function BrambleQuickUnlockSettings(): React.JSX.Element {
  const [state, setState] = useState<BrambleQuickUnlockState | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [masterPassword, setMasterPassword] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [touchId, setTouchId] = useState(false)
  const [requireMaster, setRequireMaster] = useState(false)
  /** Turning "Require master password after restarts" on asks for the PIN first. */
  const [requirePinOpen, setRequirePinOpen] = useState(false)
  const [requirePin, setRequirePin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const api = window.api.browser.bramble.quickUnlock
    const unsubscribe = api.onChange(setState)
    void api.get().then(setState).catch(() => setError('Could not read quick unlock settings.'))
    return unsubscribe
  }, [])

  // No vault yet (or Bramble still loading): re-check while this section is on screen, and when the
  // window regains focus, so creating the vault in Bramble's tab enables setup without a reload.
  const vault = state?.vault
  useEffect(() => {
    if (vault === undefined || vault === 'present') return
    const api = window.api.browser.bramble.quickUnlock
    let cancelled = false
    const recheck = (): void => {
      void api.get().then((next) => { if (!cancelled) setState(next) }).catch(() => {})
    }
    const timer = window.setInterval(recheck, VAULT_RECHECK_MS)
    window.addEventListener('focus', recheck)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', recheck)
    }
  }, [vault])

  function resetForm(): void {
    setMasterPassword('')
    setPin('')
    setConfirmPin('')
    setError('')
  }

  async function enrol(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const blocked = quickUnlockSetupBlocker(state?.vault)
    if (blocked) { setError(blocked); return }
    const pinError = quickUnlockPinError(pin, confirmPin)
    if (!masterPassword) { setError('Enter your Bramble master password.'); return }
    if (pinError) { setError(pinError); return }
    setBusy(true)
    setError('')
    try {
      const result = await window.api.browser.bramble.quickUnlock.enrol({ masterPassword, pin, confirmPin, touchId, requireMasterAfterRestart: requireMaster })
      setState(result.state)
      if (result.ok) {
        resetForm()
        setSetupOpen(false)
      } else setError(result.error)
    } catch {
      setError('Could not set up quick unlock.')
    } finally {
      setMasterPassword('')
      setBusy(false)
    }
  }

  async function disable(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.browser.bramble.quickUnlock.disable()
      setState(result.state)
      if (!result.ok) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  async function changeRequireMaster(require: boolean, pinValue?: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.browser.bramble.quickUnlock.setRequireMaster({ require, pin: pinValue })
      setState(result.state)
      if (result.ok) {
        setRequirePinOpen(false)
        setRequirePin('')
      } else setError(result.error)
    } catch {
      setError('Could not change this setting.')
    } finally {
      setRequirePin('')
      setBusy(false)
    }
  }

  async function turnOffTouchId(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.api.browser.bramble.quickUnlock.setTouchId(false)
      setState(result.state)
      if (!result.ok) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  const status = !state ? undefined : !state.enabled ? 'Off' : state.armed ? (state.touchIdEnabled ? 'PIN + Touch ID' : 'PIN') : 'Unlock Bramble once'
  const enabled = state?.enabled === true
  const setupBlocker = state ? quickUnlockSetupBlocker(state.vault) : null
  const vaultHint = setupBlocker && (
    <>
      <p className="settings-help bramble-quick-unlock-needs-vault" role="status">{setupBlocker}</p>
      {state?.vault === 'absent' && (
        <div className="settings-actions">
          <button className="settings-action secondary" type="button" onClick={() => void window.api.browser.bramble.setup().catch(() => {})}>Create your Bramble vault…</button>
        </div>
      )}
    </>
  )
  return (
    <SettingsGroup title="Quick unlock for Bramble" status={status} statusOn={state?.armed === true} className="bramble-quick-unlock-settings">
      <p className="settings-help">Unlock Bramble’s popup with a PIN{state?.touchIdAvailable ? ' or Touch ID' : ''} instead of your master password. Surffish keeps your master password encrypted on this device and types it into Bramble for you; Bramble itself is unchanged. A PIN is weaker than your master password: use it only on a device you trust.</p>
      {state?.notice && <p className="settings-message" role="status">{state.notice}</p>}
      {enabled && !setupOpen && (
        <>
          {!state.armed && state.canRearm && (
            <p className="settings-help bramble-quick-unlock-rearm-hint" role="status">
              {state.migratesOnRearm
                ? 'Unlock Bramble once with your master password in its own form. Your PIN then turns back on and keeps working after restarts.'
                : 'Unlock Bramble once with your master password in its own form and your PIN turns back on.'}
            </p>
          )}
          <SettingsRow label="Require master password after Surffish restarts" hint={requireMasterHint(state)}>
            <input
              type="checkbox"
              className="settings-switch bramble-quick-unlock-require-master"
              checked={state.requireMasterAfterRestart || requirePinOpen}
              aria-label="Require master password after Surffish restarts"
              disabled={busy || requirePinOpen || (state.requireMasterAfterRestart ? (!state.armed || !state.persistAvailable) : !state.armed)}
              onChange={(event) => {
                if (event.target.checked) { setRequirePin(''); setError(''); setRequirePinOpen(true) }
                else void changeRequireMaster(false)
              }}
            />
          </SettingsRow>
          {requirePinOpen && (
            <form className="bramble-quick-unlock-form bramble-quick-unlock-require-pin" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (requirePin) void changeRequireMaster(true, requirePin) }}>
              <SettingsRow label="Your PIN" hint="Needed to turn this on. A wrong PIN counts as a wrong attempt.">
                <input className="settings-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" value={requirePin} onChange={(event) => setRequirePin(event.target.value.replace(/\D/g, ''))} aria-label="Your PIN" disabled={busy} autoFocus />
              </SettingsRow>
              <div className="settings-actions">
                <button className="settings-action secondary" type="button" disabled={busy} onClick={() => { setRequirePinOpen(false); setRequirePin('') }}>Cancel</button>
                <button className="settings-action primary" type="submit" disabled={busy || requirePin.length < 4}>Require master password</button>
              </div>
            </form>
          )}
          <SettingsRow label="Wrong PINs" hint={`After ${state.maxAttempts} wrong PINs quick unlock turns off and needs setting up again.`}>
            <span className="settings-row-value">{state.failedAttempts} of {state.maxAttempts}</span>
          </SettingsRow>
          <div className="settings-actions">
            <button className="settings-action secondary" type="button" disabled={busy || !!setupBlocker} onClick={() => { resetForm(); setTouchId(state.touchIdEnabled); setRequireMaster(state.requireMasterAfterRestart); setSetupOpen(true) }}>Change PIN…</button>
            {state.touchIdEnabled && <button className="settings-action secondary" type="button" disabled={busy} onClick={() => void turnOffTouchId()}>Turn off Touch ID</button>}
            <button className="settings-action secondary" type="button" disabled={busy} onClick={() => void disable()}>Turn off quick unlock</button>
          </div>
          {vaultHint}
        </>
      )}
      {!enabled && !setupOpen && (
        <>
          <div className="settings-actions">
            <button className="settings-action primary" type="button" disabled={!state || busy || !!setupBlocker} title={setupBlocker ?? undefined} onClick={() => { resetForm(); setTouchId(false); setRequireMaster(!state?.persistAvailable); setSetupOpen(true) }}>Set up PIN…</button>
          </div>
          {vaultHint}
        </>
      )}
      {setupOpen && state && (
        <form className="bramble-quick-unlock-form" onSubmit={(event) => void enrol(event)} autoComplete="off">
          <SettingsRow label="Bramble master password" hint="Entered once, here. Surffish never shows it again.">
            <input className="settings-input" type="password" autoComplete="off" spellCheck={false} value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} aria-label="Bramble master password" disabled={busy} />
          </SettingsRow>
          <SettingsRow label="PIN" hint="4 to 8 digits.">
            <input className="settings-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} aria-label="New PIN" disabled={busy} />
          </SettingsRow>
          <SettingsRow label="Confirm PIN">
            <input className="settings-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="off" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))} aria-label="Confirm PIN" disabled={busy} />
          </SettingsRow>
          {state.touchIdAvailable && (
            <SettingsRow label="Also unlock with Touch ID">
              <input type="checkbox" className="settings-switch" checked={touchId} onChange={(event) => setTouchId(event.target.checked)} aria-label="Also unlock with Touch ID" disabled={busy} />
            </SettingsRow>
          )}
          <SettingsRow label="Require master password after Surffish restarts" hint={requireMaster ? 'Nothing that can unlock Bramble is written to disk. After a restart, unlock once in Bramble’s own form to turn the PIN back on.' : state.persistAvailable ? 'Off: the PIN keeps working after restarts. The encrypted master password is saved to disk; its key stays in the system keychain.' : 'Not available: this system has no secure key storage.'}>
            <input type="checkbox" className="settings-switch" checked={requireMaster} onChange={(event) => setRequireMaster(event.target.checked)} aria-label="Require master password after Surffish restarts" disabled={busy || (!state.persistAvailable && requireMaster)} />
          </SettingsRow>
          <div className="settings-actions">
            <button className="settings-action secondary" type="button" disabled={busy} onClick={() => { resetForm(); setSetupOpen(false) }}>Cancel</button>
            <button className="settings-action primary" type="submit" disabled={busy || !!setupBlocker}>{busy ? 'Saving…' : 'Turn on quick unlock'}</button>
          </div>
          {vaultHint}
        </form>
      )}
      {error && <p className="settings-message is-error" role="alert">{error}</p>}
    </SettingsGroup>
  )
}

function requireMasterHint(state: BrambleQuickUnlockState): string {
  if (state.requireMasterAfterRestart) {
    if (!state.persistAvailable) return 'On: this system has no secure key storage, so the PIN cannot survive a restart here.'
    if (!state.armed) return 'On. To turn it off (PIN keeps working after restarts), unlock Bramble once first.'
    return 'On: after Surffish restarts, unlock once with your master password in Bramble’s own form to turn the PIN back on. Nothing that can unlock Bramble is on disk.'
  }
  if (!state.armed) return 'Off: the PIN keeps working after restarts. To change this, unlock Bramble once first.'
  return 'Off: the PIN keeps working after restarts (encrypted, with its key in the system keychain).'
}
