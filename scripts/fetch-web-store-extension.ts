/**
 * Download a Chrome Web Store extension and unpack it the way Surffish installs it, for probes.
 *
 *   bun scripts/fetch-web-store-extension.ts <store-url | id | alias> [output-dir] [--raw] [--probe]
 *
 *   --raw    unpack the package as published (no Surffish shim/staging), e.g. to compare behaviour
 *   --probe  then run scripts/electron-real-extension-probe.cjs on the result
 *
 * Aliases for verified extensions: modern-for-hn (Modern for Hacker News).
 * Nothing is vendored into the repo; the package is fetched from Google at run time.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromeWebStoreCrxUrl, isAllowedChromeWebStoreDownloadUrl, parseChromeWebStoreInput } from '../src/shared/chrome-web-store.ts'
import { analyzeExtensionCompatibility } from '../src/shared/extension-compat.ts'
import { parseCrx } from '../src/main/crx.ts'
import { extractExtensionZip } from '../src/main/bramble-release.ts'
import { collectDnrRulesets, collectExtensionSources, stageWebStoreExtension } from '../src/main/web-store-extension-adapter.ts'

export const VERIFIED_WEB_STORE_EXTENSIONS: Record<string, string> = {
  'modern-for-hn': 'dabkegjlekdcmefifaolmdhnhdcplklo',
  'i-still-dont-care-about-cookies': 'edibdbjcniadpccecjdfdjjppcpchdlm'
}

const args = process.argv.slice(2)
const positional = args.filter((arg) => !arg.startsWith('--'))
const input = positional[0] ?? ''
const id = VERIFIED_WEB_STORE_EXTENSIONS[input] ?? parseChromeWebStoreInput(input)
if (!id) {
  console.error('Usage: bun scripts/fetch-web-store-extension.ts <store-url | id | modern-for-hn> [output-dir] [--raw] [--probe]')
  process.exit(2)
}
const output = resolve(positional[1] ?? join(tmpdir(), `surffish-cws-${id}`))
const prodversion = process.env.SURFFISH_CHROME_VERSION ?? '152.0.0.0'

const response = await fetch(chromeWebStoreCrxUrl(id, prodversion), { redirect: 'follow' })
if (!isAllowedChromeWebStoreDownloadUrl(response.url)) throw new Error(`Unexpected download host: ${response.url}`)
if (!response.ok || response.status === 204) throw new Error(`Download failed (HTTP ${response.status}).`)
const crx = parseCrx(Buffer.from(await response.arrayBuffer()))
if (crx.extensionId !== id || !crx.signatureVerified) throw new Error('The package identity or signature did not verify.')

const scratch = mkdtempSync(join(tmpdir(), 'surffish-cws-'))
try {
  const source = args.includes('--raw') ? output : join(scratch, 'source')
  extractExtensionZip(crx.archive, source, { label: 'extension package', maxArchiveBytes: 64 * 1024 * 1024, skip: (path) => path === '_metadata' || path.startsWith('_metadata/') })
  const staged = args.includes('--raw') ? null : stageWebStoreExtension(source, output, crx.publicKey.toString('base64'))
  const outputManifest = staged?.manifest ?? JSON.parse(await Bun.file(join(output, 'manifest.json')).text())
  const compatibility = analyzeExtensionCompatibility(outputManifest, collectExtensionSources(output), collectDnrRulesets(output, outputManifest))
  console.log(JSON.stringify({ id, format: crx.format, signatureVerified: crx.signatureVerified, output, staged: staged !== null, compatibility: { level: compatibility.level, gaps: compatibility.gaps, blockers: compatibility.blockers, shimmed: compatibility.shimmed } }, null, 2))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

if (args.includes('--probe')) {
  const electron = (await import('electron')).default as unknown as string
  const result = spawnSync(electron, [join(import.meta.dir, 'electron-real-extension-probe.cjs'), output], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}
