import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stageBrambleFirefoxBuild } from '../src/main/bramble-poc-adapter.ts'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const sourceDirectory = process.argv[2]
if (!sourceDirectory) {
  console.error('Usage: node --experimental-strip-types scripts/check-bramble-poc.ts <Bramble-dist-firefox-directory>')
  process.exit(2)
}

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))
const probeScript = join(scriptDirectory, 'electron-real-extension-probe.cjs')
const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const temporaryRoot = mkdtempSync(join(tmpdir(), 'sockfish-bramble-real-extension-'))

try {
  const staged = stageBrambleFirefoxBuild(resolve(sourceDirectory), join(temporaryRoot, 'adapted-extension'))
  let executable = electronExecutable
  let args = [probeScript, staged.stagedDirectory]
  if (process.platform === 'linux' && !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')) {
    executable = '/usr/bin/xvfb-run'
    args = ['-a', electronExecutable, ...args]
  }

  const child = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env
  })
  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  const reportLine = stdout.split(/\r?\n/).find((line) => line.startsWith('SOCKFISH_REAL_EXTENSION_PROBE_REPORT='))
  assert.ok(reportLine, `Electron probe emitted no report.\n${stderr}\n${stdout}`)
  const report = JSON.parse(reportLine.slice('SOCKFISH_REAL_EXTENSION_PROBE_REPORT='.length)) as Record<string, unknown>
  const extension = record(report.extension)
  const options = record(report.options)
  const optionsSnapshot = record(options.snapshot)
  const roots = Array.isArray(optionsSnapshot.roots) ? optionsSnapshot.roots : []
  const page = record(report.page)
  const contentContext = record(page.contentScriptContext)
  const contentWorlds = Array.isArray(contentContext.worlds) ? contentContext.worlds : []
  const browserNamespaceShimPresent = contentWorlds.some((world) => record(record(world).apis).browserNamespace === true)
  const passkeyBridge = record(page.brambleWebAuthnBridge)
  const background = record(report.serviceWorkerProbe)
  const apiPresence = record(background.apiPresence)
  const storageBehavior = record(background.storageBehavior)

  assert.equal(child.status, 0, `Electron probe exited ${child.status ?? child.signal}.\n${stderr}\n${stdout}`)
  assert.equal(report.extensionLoaded, true, `Bramble did not load.\n${stderr}\n${stdout}`)
  assert.equal(report.extensionReady, true, `Bramble did not reach extension-ready.\n${stderr}\n${stdout}`)
  assert.equal(extension.name, 'Bramble')
  assert.equal(background.available, true, `Bramble's adapted service worker did not start: ${JSON.stringify(background)}`)
  assert.equal(apiPresence.runtime, true)
  assert.equal(apiPresence.storageLocal, true)
  assert.equal(storageBehavior.storageLocalRoundTrip, true)
  assert.equal(options.loaded, true, `Bramble options page failed to load: ${JSON.stringify(options)}`)
  assert.equal(optionsSnapshot.title, 'Vault Setup')
  assert.equal(optionsSnapshot.readyState, 'complete')
  assert.ok(roots.some((root) => record(root).selector === '#root' && record(root).count === 1), 'Bramble options-page React root was not present')
  assert.ok(String(optionsSnapshot.bodyText ?? '').includes('Create vault'), 'Bramble setup UI did not render its create-vault flow')
  assert.ok(Number(contentContext.injectedIsolatedWorldCount ?? 0) >= 1, 'Bramble isolated content scripts were not injected into the inert local page')
  assert.equal(browserNamespaceShimPresent, true, 'The browser namespace shim was not present in Bramble isolated content scripts')
  assert.equal(passkeyBridge.createOverridden, true, 'Bramble did not install the page MAIN-world WebAuthn create override')
  assert.equal(passkeyBridge.getOverridden, true, 'Bramble did not install the page MAIN-world WebAuthn get override')
  assert.deepEqual(passkeyBridge.relayResult, { passthrough: true }, 'The inert no-vault WebAuthn relay did not round-trip to the Bramble background')

  console.log(JSON.stringify({
    result: 'PASS',
    brambleVersion: extension.version,
    electronVersion: report.electronVersion,
    chromiumVersion: report.chromiumVersion,
    extensionReady: report.extensionReady,
    setupPageTitle: optionsSnapshot.title,
    setupPageText: String(optionsSnapshot.bodyText ?? '').slice(0, 300),
    isolatedContentScriptWorlds: contentContext.injectedIsolatedWorldCount,
    serviceWorkerStorageLocalRoundTrip: storageBehavior.storageLocalRoundTrip,
    browserNamespaceShimPresent,
    passkeyBridgeProbe: {
      createOverridden: passkeyBridge.createOverridden ?? false,
      getOverridden: passkeyBridge.getOverridden ?? false,
      relayResult: passkeyBridge.relayResult ?? null,
      relayTimeout: passkeyBridge.relayTimeout ?? false
    },
    localPageOnly: true,
    accountUsed: report.accountUsed,
    vaultDataUsed: report.vaultDataUsed
  }, null, 2))
  console.log('Smoke test is UI/runtime-only; it did not create, import, or unlock a vault or register/assert a passkey.')
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
