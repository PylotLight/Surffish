// Keychain access probe for the macOS Safe Storage key.
//
// Run (from the repo root, after `bun run build` is not required — this is bare Electron):
//   node_modules/electron/cli.js scripts/probe-keychain.cjs            # with --use-mock-keychain
//   node_modules/electron/cli.js scripts/probe-keychain.cjs --real     # real login keychain
//
// It forces the two Safe Storage key-fetch paths (the safeStorage API and the cookie store)
// against the real "Surffish Safe Storage" keychain item and reports whether they complete.
// While a login-keychain dialog is on screen the key fetches block, so a run that prints
// `timeout` is the one that showed the dialog.

const { app, safeStorage, session } = require("electron");
const { mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const real = process.argv.includes("--real");
const mode = real ? "real" : "mock";
const userData = join(tmpdir(), `surffish-keychain-probe-${process.pid}`);
app.setPath("userData", userData);
mkdirSync(userData, { recursive: true, mode: 0o700 });
// Resolve to the release keychain item ("Surffish Safe Storage") by default;
// SURFFISH_PROBE_NAME targets another item (e.g. "Surffish Dev", "Electron").
app.setName(process.env.SURFFISH_PROBE_NAME || "Surffish");
if (!real) app.commandLine.appendSwitch("use-mock-keychain");
// No visible window: keep timers honest (App Nap would stretch the backstop below).
if (process.platform === "darwin") app.setAppNapDisabled?.(true);

const startedAt = Date.now();
function report(tag, detail) {
  console.log(
    `PROBE[${mode}] ${tag} ${detail} elapsed=${Date.now() - startedAt}ms`,
  );
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
  process.exit(tag === "timeout" ? 1 : 0);
}

let settled = false;
function finish(tag, detail) {
  if (settled) return;
  settled = true;
  report(tag, detail);
}

// If a keychain dialog is up, key fetches block; bail instead of waiting on the user.
setTimeout(
  () =>
    finish(
      "timeout",
      "a key fetch did not complete within 25s (a keychain dialog is probably on screen)",
    ),
  25_000,
);

app
  .whenReady()
  .then(async () => {
    // 1) Electron's safeStorage API: os_crypt_async -> KeychainKeyProvider -> keychain.
    // Electron 46: the key comes from the async provider, so the API is async-only.
    const available = await safeStorage.isAsyncEncryptionAvailable();
    if (!available) {
      finish("safe-storage", "reported unavailable (no key fetch)");
      return;
    }
    const encrypted = await safeStorage.encryptStringAsync("keychain-probe");
    const decryptedRaw = await safeStorage.decryptStringAsync(encrypted);
    const decrypted =
      typeof decryptedRaw === "string" ? decryptedRaw : decryptedRaw?.result;
    if (decrypted !== "keychain-probe") {
      finish(
        "safe-storage",
        `roundtrip mismatch: ${JSON.stringify(decrypted)}`,
      );
      return;
    }
    console.log(`PROBE[${mode}] safe-storage ok (key fetch + roundtrip)`);
    // 2) The cookie store: the path the app and the smoke tests actually exercise.
    await session.defaultSession.cookies.set({
      url: "http://127.0.0.1:8123/",
      name: "keychain-probe",
      value: "1",
    });
    const cookies = await session.defaultSession.cookies.get({
      url: "http://127.0.0.1:8123/",
    });
    finish("cookies", `set completed, read back ${cookies.length} cookie(s)`);
  })
  .catch((error) => finish("error", error?.message ?? String(error)));
