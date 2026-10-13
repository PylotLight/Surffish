import { expect, test } from 'bun:test'
import { onlyTestScriptsChanged, perfRelevantPaths } from './app-changed.ts'

test('docs, CI, smokes and unit tests never need a bench', () => {
  expect(perfRelevantPaths(['README.md', 'docs/perf.md', '.github/workflows/ci.yml', 'Casks/surffish.rb', 'LICENSE',
    'scripts/electron-command-palette-smoke.cjs', 'scripts/ci/bun-as-node.sh', 'src/shared/zoom.test.ts', 'scripts/perf/metrics.test.ts'])).toEqual([])
})

test('app code, deps, build steps and the bench itself do', () => {
  const paths = ['src/main/tab-overview.ts', 'src/renderer/src/views/Browser.css', 'bun.lock', 'package.json', '.bun-version',
    'electron.vite.config.ts', 'scripts/perf/bench.cjs', 'scripts/perf/perf.config.json', 'scripts/smoke-hidden.cjs',
    'scripts/build-google-sign-in.ts', 'scripts/native-build-cache.ts', 'resources/icon.png']
  expect(perfRelevantPaths(paths)).toEqual(paths)
})

test('package.json only counts when more than test scripts changed', () => {
  const base = JSON.stringify({ name: 's', scripts: { build: 'x', test: 'bun test a', 'test:electron-a': 'electron a' }, dependencies: { a: '1' } })
  expect(onlyTestScriptsChanged(base, JSON.stringify({ name: 's', scripts: { build: 'x', test: 'bun test a b', 'test:electron-b': 'electron b' }, dependencies: { a: '1' } }))).toBe(true)
  expect(onlyTestScriptsChanged(base, JSON.stringify({ name: 's', scripts: { build: 'y', test: 'bun test a' }, dependencies: { a: '1' } }))).toBe(false)
  expect(onlyTestScriptsChanged(base, JSON.stringify({ name: 's', scripts: { build: 'x', test: 'bun test a' }, dependencies: { a: '2' } }))).toBe(false)
  expect(onlyTestScriptsChanged(base, 'not json')).toBe(false)
  expect(perfRelevantPaths(['package.json'], true)).toEqual([])
})
