// Works out the download URL + SHA-256 for a version. Sources, in order:
//  1. <PREFIX>_ASSET_URL / <PREFIX>_SHA256 env overrides (testing, mirrors)
//  2. release.json baked into the npm package at publish time (no network call)
//  3. the GitHub releases API: the asset's `digest` field (GitHub computes it on upload)
//  4. a SHA256SUMS asset on the same release, if one exists
import { readFileSync } from 'node:fs'
import { findInChecksumList, normalizeVersion, parseSha256, releaseAssetUrl } from './core.mjs'

/** @typedef {import('./types.mjs').AppConfig} AppConfig */
/** @typedef {import('./types.mjs').Target} Target */

/** release.json next to package.json, or null. */
export function readManifest(url) {
  try {
    const data = JSON.parse(readFileSync(url, 'utf8'))
    const version = normalizeVersion(data?.version)
    const sha256 = parseSha256(data?.sha256)
    if (!version || !sha256) return null
    return { version, sha256, asset: String(data.asset ?? ''), size: Number(data.size) || null }
  } catch {
    return null
  }
}

function apiHeaders(env, userAgent) {
  /** @type {Record<string, string>} */
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': userAgent, 'X-GitHub-Api-Version': '2022-11-28' }
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

/**
 * GET a release from the GitHub API ("latest" or "v1.2.3").
 * @param {AppConfig} config
 * @param {string} which
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string | undefined>, userAgent?: string, signal?: AbortSignal }} [opts]
 */
export async function fetchRelease(config, which, { fetchImpl = fetch, env = process.env, userAgent = config.id, signal } = {}) {
  const path = which === 'latest' ? 'latest' : `tags/${which}`
  const url = `https://api.github.com/repos/${config.repo}/releases/${path}`
  const res = await fetchImpl(url, { headers: apiHeaders(env, userAgent), signal })
  if (res.status === 404) return null
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 429 ? ' (GitHub API rate limit? set GITHUB_TOKEN)' : ''
    throw new Error(`GitHub API ${res.status} for ${url}${hint}`)
  }
  return /** @type {any} */ (await res.json())
}

/**
 * Pulls the asset for `version` out of a release API object, with its checksum when published.
 * @param {AppConfig} config
 * @param {any} release
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, userAgent?: string }} [opts]
 * @returns {Promise<Target | null>}
 */
export async function targetFromRelease(config, release, { fetchImpl = fetch, signal, userAgent = config.id } = {}) {
  const version = normalizeVersion(release?.tag_name)
  if (!version) return null
  const assetName = config.assetName(version)
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset = assets.find((a) => a?.name === assetName)
  if (!asset) return null
  let sha256 = parseSha256(asset.digest)
  let checksumSource = 'GitHub release asset digest'
  if (!sha256) {
    const sums = assets.find((a) => /^(SHA256SUMS(\.txt)?|checksums\.txt)$/i.test(a?.name ?? ''))
    if (sums?.browser_download_url) {
      const res = await fetchImpl(sums.browser_download_url, { headers: { 'User-Agent': userAgent }, signal })
      if (res.ok) {
        sha256 = findInChecksumList(await res.text(), assetName)
        checksumSource = sums.name
      }
    }
  }
  return {
    version,
    assetName,
    url: asset.browser_download_url || releaseAssetUrl(config, version),
    sha256,
    checksumSource: sha256 ? checksumSource : 'none',
    size: Number(asset.size) || null,
  }
}

/**
 * The full resolution: request ({kind:'pinned'|'latest'}) -> Target.
 * @param {AppConfig} config
 * @param {{ kind: 'pinned', version: string } | { kind: 'latest' }} request
 * @param {{ manifest?: ReturnType<typeof readManifest>, env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, signal?: AbortSignal, userAgent?: string }} [opts]
 * @returns {Promise<Target>}
 */
export async function resolveTarget(config, request, { manifest = null, env = process.env, fetchImpl = fetch, signal, userAgent } = {}) {
  const urlOverride = env[`${config.envPrefix}_ASSET_URL`]
  const shaOverride = parseSha256(env[`${config.envPrefix}_SHA256`])
  if (urlOverride) {
    const version = request.kind === 'pinned' ? request.version : normalizeVersion(env[`${config.envPrefix}_VERSION`]) ?? '0.0.0-local'
    return { version, assetName: config.assetName(version), url: urlOverride, sha256: shaOverride, checksumSource: shaOverride ? `${config.envPrefix}_SHA256` : 'none', size: null }
  }
  const opts = { fetchImpl, signal, userAgent }
  if (request.kind === 'pinned') {
    const version = request.version
    if (shaOverride) {
      return { version, assetName: config.assetName(version), url: releaseAssetUrl(config, version), sha256: shaOverride, checksumSource: `${config.envPrefix}_SHA256`, size: null }
    }
    if (manifest && manifest.version === version) {
      return { version, assetName: config.assetName(version), url: releaseAssetUrl(config, version), sha256: manifest.sha256, checksumSource: 'the npm package (recorded at publish)', size: manifest.size }
    }
    const release = await fetchRelease(config, `v${version}`, { fetchImpl, env, signal, userAgent })
    if (!release) throw new Error(`no GitHub release v${version} in ${config.repo}`)
    const target = await targetFromRelease(config, release, opts)
    if (!target) throw new Error(`release v${version} has no ${config.assetName(version)} asset`)
    return target
  }
  const release = await fetchRelease(config, 'latest', { fetchImpl, env, signal, userAgent })
  if (!release) throw new Error(`${config.repo} has no published release yet`)
  const target = await targetFromRelease(config, release, opts)
  if (!target) throw new Error(`the latest release (${release.tag_name}) has no matching asset for this platform`)
  return target
}
