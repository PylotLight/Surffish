/** Pure helpers for `bun run release`; kept separate so they're testable without git or a Mac. */

export type Bump = "patch" | "minor" | "major";

const PLAIN_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
/** A full semver: X.Y.Z, optionally with a -prerelease or +build suffix (e.g. 0.2.0-beta.1). */
const FULL_SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): [number, number, number] {
  const match = PLAIN_SEMVER.exec(version.trim());
  if (!match) throw new Error(`not a plain X.Y.Z version: '${version}'`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export interface ReleaseVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease identifiers, semver-ordered (numeric identifiers sort below alphanumeric). */
  prerelease: Array<string | number>;
}

function parseRelease(version: string): ReleaseVersion {
  const raw = version.trim();
  const match = FULL_SEMVER.exec(raw);
  if (!match)
    throw new Error(
      `not a semver version (X.Y.Z or X.Y.Z-prerelease): '${version}'`,
    );
  const prerelease = match[4]
    ? match[4]!
        .split(".")
        .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  if (prerelease.some((part) => part === "")) {
    throw new Error(
      `not a semver version (X.Y.Z or X.Y.Z-prerelease): '${version}'`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

/** SemVer precedence: -1 if a < b, 0 if equal, 1 if a > b. A plain version outranks the same
 *  version with a prerelease; an unparseable version sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const left = parseRelease(a);
  const right = parseRelease(b);
  const order =
    (left.major > right.major ? 1 : left.major < right.major ? -1 : 0) ||
    (left.minor > right.minor ? 1 : left.minor < right.minor ? -1 : 0) ||
    (left.patch > right.patch ? 1 : left.patch < right.patch ? -1 : 0);
  if (order !== 0) return order;
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = left.prerelease[index];
    const y = right.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x > y ? 1 : -1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** True when a release version carries a prerelease suffix (e.g. 0.2.0-beta.1). */
export function isPrereleaseVersion(version: string): boolean {
  return parseRelease(version).prerelease.length > 0;
}

/**
 * Work out the version to release.
 * - `patch` / `minor` / `major` bump from the newest of package.json and the latest tag.
 * - An explicit X.Y.Z or X.Y.Z-prerelease (e.g. `0.2.0-beta.1`) must be newer than the latest tag.
 * - `current` re-uses package.json's version when it hasn't been tagged yet (already bumped by hand).
 */
export function resolveReleaseVersion(
  spec: string,
  packageVersion: string,
  latestTag: string | null,
): string {
  const tagged = latestTag ? latestTag.replace(/^v/, "") : null;
  const base =
    tagged && compareVersions(tagged, packageVersion) > 0
      ? tagged
      : packageVersion;
  let next: string;
  if (spec === "current") {
    next = packageVersion;
  } else if (spec === "patch" || spec === "minor" || spec === "major") {
    const [major, minor, patch] = parseVersion(base);
    next =
      spec === "major"
        ? `${major + 1}.0.0`
        : spec === "minor"
          ? `${major}.${minor + 1}.0`
          : `${major}.${minor}.${patch + 1}`;
  } else {
    // An explicit release version, plain (0.3.0) or a pre-release (0.2.0-beta.1).
    next = spec.trim().replace(/^v/, "");
    parseRelease(next);
  }
  if (tagged && compareVersions(next, tagged) <= 0) {
    throw new Error(`v${next} isn't newer than the latest tag v${tagged}`);
  }
  return next;
}

/** Newest vX.Y.Z tag from a `git tag` listing, ignoring anything that isn't plain semver. */
export function latestVersionTag(tags: string[]): string | null {
  const versions = tags
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  versions.sort((a, b) => compareVersions(a.slice(1), b.slice(1)));
  return versions.at(-1) ?? null;
}

/** Rewrite only the top-level "version" field, keeping the file's formatting intact. */
export function setPackageVersion(
  packageJson: string,
  version: string,
): string {
  const updated = packageJson.replace(
    /^(\s*"version"\s*:\s*")[^"]*(")/m,
    `$1${version}$2`,
  );
  if (
    updated === packageJson &&
    !packageJson.includes(`"version": "${version}"`)
  )
    throw new Error('no "version" field in package.json');
  return updated;
}

/** Starter notes from commit subjects since the last tag, for when docs/releases/vX.Y.Z.md doesn't exist yet. */
export function draftReleaseNotes(version: string, subjects: string[]): string {
  const lines = subjects
    .map((subject) => subject.trim())
    .filter(
      (subject) =>
        subject &&
        !/^chore(\(.*\))?: (release|update surffish cask)/i.test(subject),
    )
    .map((subject) => `- ${subject}`);
  return `# Surffish v${version}\n\n## Changes\n${lines.length ? lines.join("\n") : "- "}\n\n## Packaging\n- Still unsigned and not notarized. If macOS says it's damaged, run \`xattr -cr /Applications/Surffish.app\` on a copy you got from the official release\n`;
}

/** `--from-tag` takes the version to rebuild explicitly (X.Y.Z or vX.Y.Z); it must already be tagged. */
export function resolveFromTagVersion(spec: string, tags: string[]): string {
  const version = spec.trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(
      `--from-tag needs the tag's version as X.Y.Z, got '${spec}'`,
    );
  if (!tags.map((tag) => tag.trim()).includes(`v${version}`))
    throw new Error(`--from-tag: there's no v${version} tag`);
  return version;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
  "trustedDependencies",
  "patchedDependencies",
] as const;

/**
 * Dependency fields of two package.json files that differ (empty = same). `--from-tag` builds an old
 * tag with main's node_modules (no second `bun install`), so it only does that when these match.
 */
export function dependencyDifferences(
  packageJsonA: string,
  packageJsonB: string,
): string[] {
  const a = JSON.parse(packageJsonA);
  const b = JSON.parse(packageJsonB);
  return DEPENDENCY_FIELDS.filter(
    (field) =>
      JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null),
  );
}

/** A <string> value from an XML plist (e.g. CFBundleShortVersionString), or null if it's not there. */
export function plistString(xml: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<key>\\s*${escaped}\\s*</key>\\s*<string>([^<]*)</string>`,
  ).exec(xml);
  return match ? match[1]!.trim() : null;
}
