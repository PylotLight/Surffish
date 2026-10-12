import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftReleaseNotes, latestVersionTag, resolveReleaseVersion, setPackageVersion } from './release-version.ts'

test('bumps patch, minor and major from the latest tag', () => {
  assert.equal(resolveReleaseVersion('patch', '0.1.1', 'v0.1.1'), '0.1.2')
  assert.equal(resolveReleaseVersion('minor', '0.1.1', 'v0.1.1'), '0.2.0')
  assert.equal(resolveReleaseVersion('major', '0.1.1', 'v0.1.1'), '1.0.0')
})

test('bumps from whichever of package.json and the tag is newer', () => {
  assert.equal(resolveReleaseVersion('patch', '0.1.0', 'v0.1.3'), '0.1.4')
  assert.equal(resolveReleaseVersion('patch', '0.2.0', 'v0.1.3'), '0.2.1')
  assert.equal(resolveReleaseVersion('patch', '0.1.0', null), '0.1.1')
})

test('current re-uses an untagged package.json version', () => {
  assert.equal(resolveReleaseVersion('current', '0.1.2', 'v0.1.1'), '0.1.2')
  assert.throws(() => resolveReleaseVersion('current', '0.1.1', 'v0.1.1'), /isn't newer/)
})

test('explicit versions must be newer than the latest tag and plain semver', () => {
  assert.equal(resolveReleaseVersion('0.3.0', '0.1.1', 'v0.1.1'), '0.3.0')
  assert.throws(() => resolveReleaseVersion('0.1.0', '0.1.1', 'v0.1.1'), /isn't newer/)
  assert.throws(() => resolveReleaseVersion('banana', '0.1.1', 'v0.1.1'), /X\.Y\.Z/)
})

test('latestVersionTag sorts numerically and skips junk', () => {
  assert.equal(latestVersionTag(['v0.1.9', 'v0.1.10', 'v0.2.0-beta', 'nightly', 'v0.1.2']), 'v0.1.10')
  assert.equal(latestVersionTag([]), null)
})

test('setPackageVersion only touches the top-level version', () => {
  const json = '{\n  "name": "surffish",\n  "version": "0.1.1",\n  "dependencies": { "x": { "version": "9.9.9" } }\n}\n'
  assert.equal(setPackageVersion(json, '0.1.2'), json.replace('"version": "0.1.1"', '"version": "0.1.2"'))
})

test('draft notes list commits and drop release chores', () => {
  const notes = draftReleaseNotes('0.1.2', ['fix(tabs): thing (#44)', 'chore(tap): update Surffish Cask to v0.1.1', 'chore: release v0.1.1'])
  assert.match(notes, /^# Surffish v0\.1\.2/)
  assert.match(notes, /- fix\(tabs\): thing \(#44\)/)
  assert.doesNotMatch(notes, /Cask to v0\.1\.1/)
})
