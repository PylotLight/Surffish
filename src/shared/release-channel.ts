/**
 * Release channels. A plain X.Y.Z version is the stable app; a pre-release version
 * (X.Y.Z-beta.N-e45, X.Y.Z-nightly.N-e46, ...) is a test build that installs and runs beside it:
 * its own app name and bundle id, its own profile (userData), its own compile cache, and update
 * checks that include pre-releases. No Electron imports: main, renderer, release scripts and unit
 * tests share it.
 */

export type ReleaseChannel = 'stable' | 'beta' | 'nightly' | 'alpha'

const STABLE_NAME = 'Surffish'
const PRERELEASE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z][0-9A-Za-z.-]*)$/

/** The channel a version belongs to: stable for X.Y.Z, else from the pre-release's first word. */
export function releaseChannelOf(version: string): ReleaseChannel {
  const match = PRERELEASE_VERSION.exec(version.trim())
  if (!match) return 'stable'
  const word = (match[4] ?? '').split(/[.-]/)[0]!.toLowerCase()
  if (word === 'nightly') return 'nightly'
  if (word === 'alpha') return 'alpha'
  return 'beta'
}

/** True for a well-formed pre-release version (X.Y.Z-something). */
export function isPrereleaseVersionString(version: string): boolean {
  return PRERELEASE_VERSION.test(version.trim())
}

/** The Electron major a pre-release names with an `eNN` part (`0.1.10-beta.1-e45` -> 45), else null. */
export function electronMajorTag(version: string): number | null {
  const match = PRERELEASE_VERSION.exec(version.trim())
  if (!match) return null
  const tag = /(?:^|[.-])e(\d{2,3})(?:$|[.-])/i.exec(match[4] ?? '')
  return tag ? Number(tag[1]) : null
}

/** App name (and the profile / cache folder name) for a channel: "Surffish", "Surffish Beta", ... */
export function channelProductName(channel: ReleaseChannel): string {
  if (channel === 'stable') return STABLE_NAME
  return `${STABLE_NAME} ${channel[0]!.toUpperCase()}${channel.slice(1)}`
}

/** Bundle id for a channel: com.pylotlight.surffish, com.pylotlight.surffish.beta, ... */
export function channelAppId(channel: ReleaseChannel, stableAppId = 'com.pylotlight.surffish'): string {
  return channel === 'stable' ? stableAppId : `${stableAppId}.${channel}`
}

/** One line for About: "Surffish Beta 0.1.10-beta.1-e45 · Electron 45.0.0-beta.3 · Chromium 156.0.8078.12". */
export function versionLine(appVersion: string, versions: { electron?: string; chrome?: string } = {}): string {
  const parts = [`${channelProductName(releaseChannelOf(appVersion))} ${appVersion}`]
  if (versions.electron) parts.push(`Electron ${versions.electron}`)
  if (versions.chrome) parts.push(`Chromium ${versions.chrome}`)
  return parts.join(' · ')
}
