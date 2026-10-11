import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDownloadSize, getDownloadProgress, safeDownloadFilename, safeDownloadSource, safeStoredDownloadSource } from './downloads.ts'

const syntheticDownloadData = [
  { url: 'https://user:private@example.test/files/report.pdf?token=never-display', name: '../report.pdf', received: 512, total: 1024 },
  { url: 'blob:https://downloads.example.test/9a8f', name: 'photo.png', received: 1024 * 1024, total: 0 },
  { url: 'file:///tmp/secret.txt', name: 'notes\\private.txt', received: 1200, total: 600 }
]

test('download source strips credentials, paths, queries, fragments and local file paths', () => {
  assert.equal(safeDownloadSource(syntheticDownloadData[0]!.url), 'example.test')
  assert.equal(safeDownloadSource(syntheticDownloadData[1]!.url), 'downloads.example.test')
  assert.equal(safeDownloadSource(syntheticDownloadData[2]!.url), 'Local file')
  assert.equal(safeDownloadSource('not a url'), 'Unknown source')
})

test('persisted download source labels stay host-only when history is reloaded', () => {
  assert.equal(safeStoredDownloadSource('127.0.0.1'), '127.0.0.1')
  assert.equal(safeStoredDownloadSource('https://user:private@example.test/private?token=never-display'), 'example.test')
  assert.equal(safeStoredDownloadSource('Local file'), 'Local file')
  assert.equal(safeStoredDownloadSource('Unknown source'), 'Unknown source')
})

test('download filenames are safe to display without path separators or control characters', () => {
  assert.equal(safeDownloadFilename(syntheticDownloadData[0]!.name), 'report.pdf')
  assert.equal(safeDownloadFilename(syntheticDownloadData[2]!.name), 'private.txt')
  assert.equal(safeDownloadFilename('  \u0000  '), 'Download')
})

test('download progress handles unknown sizes and clamps synthetic progress to 0–100', () => {
  assert.equal(getDownloadProgress(syntheticDownloadData[0]!.received, syntheticDownloadData[0]!.total), 50)
  assert.equal(getDownloadProgress(syntheticDownloadData[1]!.received, syntheticDownloadData[1]!.total), null)
  assert.equal(getDownloadProgress(syntheticDownloadData[2]!.received, syntheticDownloadData[2]!.total), 100)
  assert.equal(getDownloadProgress(-5, 10), 0)
})

test('download size formatting uses readable units', () => {
  assert.equal(formatDownloadSize(500), '500 B')
  assert.equal(formatDownloadSize(1024), '1.0 KB')
  assert.equal(formatDownloadSize(1024 * 1024), '1.0 MB')
  assert.equal(formatDownloadSize(-1), 'Unknown size')
})
