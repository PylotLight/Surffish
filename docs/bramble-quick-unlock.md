# Bramble quick unlock (PIN / Touch ID)

Surffish-only. Bramble is never patched: when Bramble's popup shows its master-password unlock form,
Surffish draws its PIN pad over it, and a correct PIN (or Touch ID) decrypts the master password in
Surffish's main process and types it into Bramble's own form. Code: `src/main/bramble-quick-unlock*.ts`,
`src/shared/bramble-quick-unlock.ts`, Settings → Integrations → Quick unlock for Bramble.

## One screen at a time

- Quick unlock armed: Surffish's PIN pad (and Touch ID) over the popup. **Use master password** hides
  it for that lock and leaves Bramble's form in front.
- Not armed: no Surffish overlay at all, just Bramble's own form. Surffish has no master password
  screen of its own.

## After a restart

| Mode | On disk | After Surffish restarts |
| --- | --- | --- |
| **PIN keeps working** (default) | device key protected by `safeStorage` (macOS Keychain), PIN slot and Touch ID slot | PIN and Touch ID work straight away. The master password is never needed again. |
| **Require master password after Surffish restarts** | only the PIN wrapped under the master password (`rearm`) | not armed. Unlock once in Bramble's own form; Surffish sees the master password it was given and, if it opens `rearm`, turns the PIN back on. |

Persisted is the default for new setups wherever `safeStorage` can protect the key. Where it can't
(Linux without a keyring), memory-only is the only option.

The switch is in Settings after setup:

- To **persisted** (switch off): needs quick unlock armed right now (the in-memory slots are what gets
  written). Disabled with a hint otherwise.
- To **memory-only** (switch on): asks for the PIN. It is checked like any PIN attempt, so a wrong
  one counts towards the 5-strike lockout.

### How Surffish sees the master password in memory-only mode

A capture-phase `submit` listener in Surffish's isolated world of Bramble's popup (world 1977, the
same one the fill runs in; Bramble's scripts can't see it). It only keeps a value from a form with
exactly one password field named `masterPassword` (the unlock form, never setup or change
password). Main takes and clears it, waits until Bramble has actually unlocked, then offers it to the
vault, which re-arms only if it decrypts `rearm`. The listener is switched off (and anything
collected dropped) while quick unlock is armed and before Surffish's own fill.

## Migration from the old default

Memory-only used to be the default and could only be picked at setup. A memory-only file without
`restartModeChosen` (written before this change) moves to persisted the first time it is re-armed
with the master password, if `safeStorage` is available. So an existing setup asks for the master
password one last time, in Bramble's own form, and never again. Choosing memory-only explicitly (at
setup or with the Settings switch) sets `restartModeChosen` and is never migrated.

## Checks

- Unit: `src/main/bramble-quick-unlock-vault.test.ts`, `src/shared/bramble-quick-unlock.test.ts`.
- Real Bramble (not in CI, needs an unpacked Bramble Firefox build):
  `bun run build && xvfb-run -a electron --no-sandbox scripts/check-bramble-quick-unlock-app.cjs <dir>`
  runs three Surffish processes on one profile: setup and PIN pad; restart with an old memory-only
  enrolment (no overlay, re-arm from Bramble's form, migration); restart again (armed straight away,
  Settings switch both ways). Phase 3 needs working `safeStorage`; on headless Linux wrap it with
  `dbus-run-session -- scripts/with-linux-keyring.sh … --password-store=gnome-libsecret`.
