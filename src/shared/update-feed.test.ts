import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_UPDATE_FEED_URL,
  DEFAULT_UPDATE_PREFERENCES,
  compareSemver,
  decideUpdate,
  describeFeedHttpFailure,
  effectiveFeedUrl,
  isNewerVersion,
  isPrereleaseVersion,
  isUpdateCheckDue,
  normalizeFeedUrl,
  normalizeVersionTag,
  parseReleaseFeed,
  parseSemver,
  parseUpdatePreferences,
  pickLatestRelease,
  redactFeedUrl,
  releaseAssetCandidates,
  releaseNotesToText,
  toReleaseInfo,
  type UpdatePreferences
} from './update-feed.ts'

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'surffish-releases.atom'), 'utf8')

test('parses the GitHub releases Atom fixture', () => {
  const entries = parseReleaseFeed(fixture)
  // The non-semver "nightly" entry is ignored.
  assert.deepEqual(entries.map((entry) => entry.tag), ['v0.1.1', 'v0.1.0', 'v0.2.0-beta.1'])
  const latest = entries[0]!
  assert.equal(latest.version, '0.1.1')
  assert.equal(latest.title, 'Surffish v0.1.1')
  assert.equal(latest.updated, '2026-10-12T13:42:05Z')
  assert.equal(latest.link, 'https://github.com/PylotLight/Surffish/releases/tag/v0.1.1')
  assert.match(latest.contentHtml, /^<h1>Surffish v0\.1\.1<\/h1>/)
  assert.match(latest.contentHtml, /href="https:\/\/github\.com\/PylotLight\/Surffish\/pull\/36"/)
})

test('rejects documents that are not Atom feeds', () => {
  assert.throws(() => parseReleaseFeed('<html><body>Sign in</body></html>'), /not an Atom feed/)
  assert.deepEqual(parseReleaseFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), [])
})

test('falls back to the <id> for the tag and drops non-http links', () => {
  const entry = parseReleaseFeed(`<feed><entry><id>tag:example,2008:Repo/1/v1.2.3</id><link href="javascript:alert(1)"/><title>x</title></entry></feed>`)[0]!
  assert.equal(entry.tag, 'v1.2.3')
  assert.equal(entry.version, '1.2.3')
  assert.equal(entry.link, '')
})

test('release notes become plain text with no markup or scripts', () => {
  const entries = parseReleaseFeed(fixture)
  const notes = toReleaseInfo(entries[0]!).notes
  assert.match(notes, /^# Surffish v0\.1\.1\n\n## New\n• Sign in with Google/)
  assert.ok(!notes.includes('<'), 'no tags survive')
  assert.ok(!notes.includes('&lt;') && !notes.includes('&amp;'), 'entities are decoded once')
  const beta = toReleaseInfo(entries[2]!).notes
  assert.equal(beta, '## Beta\n\nTry the new stuff & report back.')
  assert.equal(releaseNotesToText('<p>a &lt;b&gt; c</p><style>p{}</style><!-- hi -->'), 'a <b> c')
})

test('semver parsing handles the v prefix, pre-releases and build metadata', () => {
  assert.deepEqual(parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseSemver('1.2.3-beta.2+build.5'), { major: 1, minor: 2, patch: 3, prerelease: ['beta', 2] })
  assert.equal(parseSemver('1.2'), null)
  assert.equal(parseSemver('nightly'), null)
  assert.equal(normalizeVersionTag(' v0.1.1 '), '0.1.1')
  assert.equal(isPrereleaseVersion('v0.2.0-rc.1'), true)
  assert.equal(isPrereleaseVersion('0.2.0'), false)
})

test('semver comparison follows SemVer 2.0 precedence', () => {
  const ordered = ['0.1.0', '0.1.1', '0.1.10', '0.2.0-alpha', '0.2.0-alpha.1', '0.2.0-alpha.beta', '0.2.0-beta', '0.2.0-beta.2', '0.2.0-beta.11', '0.2.0-rc.1', '0.2.0', '1.0.0']
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareSemver(ordered[index - 1]!, ordered[index]!), -1, `${ordered[index - 1]} < ${ordered[index]}`)
    assert.equal(compareSemver(ordered[index]!, ordered[index - 1]!), 1)
  }
  assert.equal(compareSemver('v1.0.0', '1.0.0+abc'), 0)
  assert.equal(isNewerVersion('v0.1.2', '0.1.1'), true)
  assert.equal(isNewerVersion('0.1.1', 'v0.1.1'), false)
  assert.equal(isNewerVersion('garbage', '0.1.1'), false)
})

test('pre-releases are ignored unless the beta channel is on', () => {
  const entries = parseReleaseFeed(fixture)
  assert.equal(pickLatestRelease(entries, { includePrereleases: false })?.tag, 'v0.1.1')
  assert.equal(pickLatestRelease(entries, { includePrereleases: true })?.tag, 'v0.2.0-beta.1')
  assert.equal(pickLatestRelease([], { includePrereleases: true }), null)
})

const prefs = (patch: Partial<UpdatePreferences> = {}): UpdatePreferences => ({ ...DEFAULT_UPDATE_PREFERENCES, ...patch })
const NOW = 1_800_000_000_000

test('update decision: newer, same and older versions', () => {
  assert.deepEqual(decideUpdate('0.1.2', '0.1.1', prefs(), NOW), { updateAvailable: true, showBadge: true, notify: true, skipped: false, snoozed: false })
  assert.equal(decideUpdate('0.1.1', '0.1.1', prefs(), NOW).updateAvailable, false)
  assert.equal(decideUpdate('0.1.0', '0.1.1', prefs(), NOW).updateAvailable, false)
  assert.equal(decideUpdate(null, '0.1.1', prefs(), NOW).updateAvailable, false)
})

test('skip logic hides only the skipped version', () => {
  const skipped = decideUpdate('0.1.2', '0.1.1', prefs({ skippedVersion: '0.1.2' }), NOW)
  assert.deepEqual(skipped, { updateAvailable: true, showBadge: false, notify: false, skipped: true, snoozed: false })
  const newer = decideUpdate('0.1.3', '0.1.1', prefs({ skippedVersion: '0.1.2' }), NOW)
  assert.equal(newer.showBadge, true)
  assert.equal(newer.notify, true)
})

test('each version notifies once; remind-later snoozes and then re-notifies', () => {
  assert.equal(decideUpdate('0.1.2', '0.1.1', prefs({ notifiedVersion: '0.1.2' }), NOW).notify, false)
  assert.equal(decideUpdate('0.1.2', '0.1.1', prefs({ notifiedVersion: '0.1.2' }), NOW).showBadge, true)
  const snoozed = decideUpdate('0.1.2', '0.1.1', prefs({ notifiedVersion: '0.1.2', remindLaterVersion: '0.1.2', remindAfter: NOW + 1000 }), NOW)
  assert.deepEqual(snoozed, { updateAvailable: true, showBadge: false, notify: false, skipped: false, snoozed: true })
  const expired = decideUpdate('0.1.2', '0.1.1', prefs({ notifiedVersion: '0.1.2', remindLaterVersion: '0.1.2', remindAfter: NOW - 1 }), NOW)
  assert.equal(expired.showBadge, true)
  assert.equal(expired.notify, true)
  // A snooze for an older version does not hide a newer release.
  assert.equal(decideUpdate('0.1.3', '0.1.1', prefs({ remindLaterVersion: '0.1.2', remindAfter: NOW + 1000 }), NOW).showBadge, true)
})

test('scheduled checks are due after the interval', () => {
  assert.equal(isUpdateCheckDue(null, NOW), true)
  assert.equal(isUpdateCheckDue(NOW - 1000, NOW), false)
  assert.equal(isUpdateCheckDue(NOW - 6 * 60 * 60 * 1000, NOW), true)
  assert.equal(isUpdateCheckDue(NOW + 60_000, NOW), true, 'a clock that went backwards does not stall checks')
})

test('feed URLs: http(s) only, blank means the default', () => {
  assert.equal(normalizeFeedUrl(''), '')
  assert.equal(normalizeFeedUrl(`  ${DEFAULT_UPDATE_FEED_URL} `), '')
  assert.equal(normalizeFeedUrl('http://nas.local:8080/surffish.atom'), 'http://nas.local:8080/surffish.atom')
  assert.equal(normalizeFeedUrl('file:///etc/passwd'), null)
  assert.equal(normalizeFeedUrl('javascript:alert(1)'), null)
  assert.equal(normalizeFeedUrl('not a url'), null)
  assert.equal(normalizeFeedUrl(42), null)
  assert.equal(effectiveFeedUrl({ feedUrl: '' }), DEFAULT_UPDATE_FEED_URL)
  assert.equal(redactFeedUrl('https://user:pw@feeds.example.com/r.atom?token=abc#x'), 'https://feeds.example.com/r.atom?…')
})

test('HTTP failures: a GitHub 404 means the repo is private', () => {
  assert.deepEqual(describeFeedHttpFailure(404, DEFAULT_UPDATE_FEED_URL), { status: 'unavailable', message: 'Update check unavailable (repo private)' })
  assert.equal(describeFeedHttpFailure(404, 'https://nas.example/feed.atom').message, 'Update check unavailable (feed not found)')
  assert.equal(describeFeedHttpFailure(401, DEFAULT_UPDATE_FEED_URL).status, 'unavailable')
  assert.equal(describeFeedHttpFailure(500, DEFAULT_UPDATE_FEED_URL).status, 'error')
})

test('asset candidates follow the release script naming on macOS only', () => {
  const link = 'https://github.com/PylotLight/Surffish/releases/tag/v0.1.2'
  assert.deepEqual(releaseAssetCandidates(link, '0.1.2', 'darwin', 'arm64'), [
    'https://github.com/PylotLight/Surffish/releases/download/v0.1.2/Surffish-0.1.2-mac-arm64.dmg',
    'https://github.com/PylotLight/Surffish/releases/download/v0.1.2/Surffish-0.1.2-mac-arm64.zip'
  ])
  assert.deepEqual(releaseAssetCandidates(link, '0.1.2', 'linux', 'x64'), [])
  assert.deepEqual(releaseAssetCandidates('https://nas.example/releases/tag/v0.1.2', '0.1.2', 'darwin', 'arm64'), [])
})

test('preferences parse defensively', () => {
  assert.deepEqual(parseUpdatePreferences(null), DEFAULT_UPDATE_PREFERENCES)
  assert.deepEqual(parseUpdatePreferences({
    feedUrl: 'ftp://x', betaChannel: 'yes', skippedVersion: 'v0.1.2', remindLaterVersion: 'nope', remindAfter: -5, notifiedVersion: '0.1.2', lastChecked: NOW
  }), { ...DEFAULT_UPDATE_PREFERENCES, skippedVersion: '0.1.2', notifiedVersion: '0.1.2', lastChecked: NOW })
})
