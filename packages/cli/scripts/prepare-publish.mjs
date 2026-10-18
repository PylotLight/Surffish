#!/usr/bin/env node
// Release workflow (and the one-time manual first publish): stamp packages/cli for a release.
//   node packages/cli/scripts/prepare-publish.mjs --version 0.1.22 [--verify-download] [--allow-missing]
// - sets package.json "version"
// - writes release.json { version, asset, sha256, size } from the GitHub release's asset digest, so the
//   launcher can verify the zip without an API call (npm provenance then attests that checksum too)
// - --verify-download also downloads the zip and checks the digest against it
// - --allow-missing (dry runs): no release for that version yet -> warn, publish without release.json
// Not shipped in the package (not in "files").
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../app.config.mjs'
import { assertChecksum, normalizeVersion } from '../lib/core.mjs'
import { download } from '../lib/launcher.mjs'
import { fetchRelease, targetFromRelease } from '../lib/release.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const version = normalizeVersion(value('--version') ?? '')
if (!version) { console.error('usage: prepare-publish.mjs --version X.Y.Z [--verify-download] [--allow-missing]'); process.exit(2) }

const pkgUrl = new URL('../package.json', import.meta.url)
const manifestUrl = new URL('../release.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
pkg.version = version
writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n')
console.log(`${pkg.name} version -> ${version}`)

const release = await fetchRelease(config, `v${version}`)
const target = release ? await targetFromRelease(config, release) : null
if (!target?.sha256) {
  const why = !release ? `no GitHub release v${version}` : !target ? `release v${version} has no ${config.assetName(version)}` : `no digest for ${config.assetName(version)}`
  rmSync(manifestUrl, { force: true })
  if (flag('--allow-missing')) {
    console.log(`::warning::${why}; packing without release.json (the launcher falls back to the GitHub API)`)
    process.exit(0)
  }
  console.error(`::error::${why}`)
  process.exit(1)
}

if (flag('--verify-download')) {
  const tmp = join(tmpdir(), `${config.id}-verify-${process.pid}.zip`)
  try {
    const { sha256, bytes } = await download(target.url, tmp, { userAgent: `${pkg.name}-publish` })
    assertChecksum(sha256, target.sha256, target.assetName)
    console.log(`downloaded ${bytes} bytes, sha256 matches the release digest`)
  } finally {
    rmSync(tmp, { force: true })
  }
}

writeFileSync(manifestUrl, JSON.stringify({ version, asset: target.assetName, sha256: target.sha256, size: target.size }, null, 2) + '\n')
console.log(`release.json: ${target.assetName} sha256 ${target.sha256} (${target.checksumSource})`)
