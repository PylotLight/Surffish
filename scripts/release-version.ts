/** Pure helpers for `bun run release`; kept separate so they're testable without git or a Mac. */

export type Bump = 'patch' | 'minor' | 'major'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

export function parseVersion(version: string): [number, number, number] {
  const match = SEMVER.exec(version.trim())
  if (!match) throw new Error(`not a plain X.Y.Z version: '${version}'`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0)
  return 0
}

/**
 * Work out the version to release.
 * - `patch` / `minor` / `major` bump from the newest of package.json and the latest tag.
 * - An explicit X.Y.Z must be newer than the latest tag.
 * - `current` re-uses package.json's version when it hasn't been tagged yet (already bumped by hand).
 */
export function resolveReleaseVersion(spec: string, packageVersion: string, latestTag: string | null): string {
  const tagged = latestTag ? latestTag.replace(/^v/, '') : null
  const base = tagged && compareVersions(tagged, packageVersion) > 0 ? tagged : packageVersion
  let next: string
  if (spec === 'current') {
    next = packageVersion
  } else if (spec === 'patch' || spec === 'minor' || spec === 'major') {
    const [major, minor, patch] = parseVersion(base)
    next = spec === 'major' ? `${major + 1}.0.0` : spec === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
  } else {
    parseVersion(spec)
    next = spec.trim()
  }
  if (tagged && compareVersions(next, tagged) <= 0) {
    throw new Error(`v${next} isn't newer than the latest tag v${tagged}`)
  }
  return next
}

/** Newest vX.Y.Z tag from a `git tag` listing, ignoring anything that isn't plain semver. */
export function latestVersionTag(tags: string[]): string | null {
  const versions = tags.map((tag) => tag.trim()).filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  versions.sort((a, b) => compareVersions(a.slice(1), b.slice(1)))
  return versions.at(-1) ?? null
}

/** Rewrite only the top-level "version" field, keeping the file's formatting intact. */
export function setPackageVersion(packageJson: string, version: string): string {
  const updated = packageJson.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`)
  if (updated === packageJson && !packageJson.includes(`"version": "${version}"`)) throw new Error('no "version" field in package.json')
  return updated
}

/** Starter notes from commit subjects since the last tag, for when docs/releases/vX.Y.Z.md doesn't exist yet. */
export function draftReleaseNotes(version: string, subjects: string[]): string {
  const lines = subjects
    .map((subject) => subject.trim())
    .filter((subject) => subject && !/^chore(\(.*\))?: (release|update surffish cask)/i.test(subject))
    .map((subject) => `- ${subject}`)
  return `# Surffish v${version}\n\n## Changes\n${lines.length ? lines.join('\n') : '- '}\n\n## Packaging\n- Still unsigned and not notarized. If macOS says it's damaged, run \`xattr -cr /Applications/Surffish.app\` on a copy you got from the official release\n`
}
