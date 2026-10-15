import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelAppId, channelProductName, electronMajorTag, isPrereleaseVersionString, releaseChannelOf, versionLine } from './release-channel'

test('channels from versions', () => {
  assert.equal(releaseChannelOf('0.1.9'), 'stable')
  assert.equal(releaseChannelOf('0.1.10-beta.1-e45'), 'beta')
  assert.equal(releaseChannelOf('v0.1.10-nightly.2-e46'), 'nightly')
  assert.equal(releaseChannelOf('0.2.0-alpha.1'), 'alpha')
  assert.equal(releaseChannelOf('0.2.0-rc.1'), 'beta')
  assert.equal(releaseChannelOf('not a version'), 'stable')
  assert.ok(isPrereleaseVersionString('0.1.10-beta.1') && !isPrereleaseVersionString('0.1.10'))
})

test('names, ids and the About line', () => {
  assert.equal(channelProductName('stable'), 'Surffish')
  assert.equal(channelProductName('beta'), 'Surffish Beta')
  assert.equal(channelProductName('nightly'), 'Surffish Nightly')
  assert.equal(channelAppId('stable'), 'com.pylotlight.surffish')
  assert.equal(channelAppId('nightly'), 'com.pylotlight.surffish.nightly')
  assert.equal(electronMajorTag('0.1.10-beta.1-e45'), 45)
  assert.equal(electronMajorTag('0.1.10-nightly.e46.3'), 46)
  assert.equal(electronMajorTag('0.1.10-beta.1'), null)
  assert.equal(versionLine('0.1.10-beta.1-e45', { electron: '45.0.0-beta.3', chrome: '156.0.8078.12' }), 'Surffish Beta 0.1.10-beta.1-e45 · Electron 45.0.0-beta.3 · Chromium 156.0.8078.12')
  assert.equal(versionLine('0.1.9'), 'Surffish 0.1.9')
})
