import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { appPayload, appPayloadFiles, productionDependencies, runtimeEntry } from './app-payload.ts'

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'payload-'))
  const file = (path: string, bytes: number) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), 'x'.repeat(bytes)) }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    dependencies: { a: '1' },
    devDependencies: { dev: '1' },
    build: { files: ['out/**/*', 'package.json', '!**/node_modules/**/*.map'] }
  }))
  file('out/main/index.js', 100)
  file('src/ignored.ts', 1000)
  mkdirSync(join(dir, 'node_modules/a'), { recursive: true })
  writeFileSync(join(dir, 'node_modules/a/package.json'), JSON.stringify({ dependencies: { b: '1' } }))
  file('node_modules/a/index.js', 10)
  file('node_modules/a/index.js.map', 5000)
  mkdirSync(join(dir, 'node_modules/b'), { recursive: true })
  writeFileSync(join(dir, 'node_modules/b/package.json'), '{}')
  file('node_modules/b/index.js', 20)
  mkdirSync(join(dir, 'node_modules/dev'), { recursive: true })
  writeFileSync(join(dir, 'node_modules/dev/package.json'), '{}')
  file('node_modules/dev/index.js', 9000)
  return dir
}

test('counts build.files and the production dependency closure, minus exclusions', () => {
  const dir = fixture()
  try {
    const pkgBytes = Bun.file(join(dir, 'package.json')).size
    const r = appPayload(dir)
    // out/main/index.js + package.json + a/{package.json,index.js} + b/{package.json,index.js}
    expect(r.appFiles).toBe(6)
    expect(r.appPayload).toBe(100 + pkgBytes + Bun.file(join(dir, 'node_modules/a/package.json')).size + 10 + 2 + 20)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The build.files exclusions trim the shipped node_modules down to what main actually loads (ESM builds of
// @ghostery/@remusao, tldts-experimental's self-contained CJS bundle). Guard against an exclusion (or a
// dependency upgrade) dropping a file main needs: walk the static import graph from each direct
// dependency's import entry and require that each file is packed.

const repo = resolvePath(import.meta.dir, '../..')
// Resolved with require.resolve at runtime (adblocker-electron's PRELOAD_PATH, evaluated on import).
const REQUIRE_RESOLVED = ['@ghostery/adblocker-electron-preload']
const SPECIFIER = /(?:^|[\s;}])(?:import|export)\s*(?:[^'"()]*?\sfrom\s*)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g

function bareEntry(specifier: string): string | null {
  if (specifier.startsWith('node:') || specifier === 'electron') return null
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
  if (name !== specifier) throw new Error(`subpath import ${specifier} isn't handled by this check`)
  return existsSync(join(repo, 'node_modules', name, 'package.json')) ? runtimeEntry(repo, name) : null
}

test('every file main loads from production node_modules is packed', () => {
  if (!existsSync(join(repo, 'node_modules', '@ghostery', 'adblocker-electron', 'package.json'))) return
  const kept = new Set(appPayloadFiles(repo))
  // Start at what main imports (package.json dependencies) and follow imports: a dependency nothing
  // imports at runtime (tldts-core: tldts-experimental's CJS bundle inlines it) may be trimmed.
  const direct = Object.keys(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).dependencies ?? {})
  expect(productionDependencies(repo)).toEqual(expect.arrayContaining(direct))
  const queue = direct.map((name) => runtimeEntry(repo, name))
  const seen = new Set<string>()
  const missing: string[] = []
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (!kept.has(file)) { missing.push(file); continue }
    if (!/\.(?:c|m)?js$/.test(file)) continue
    for (const match of readFileSync(join(repo, file), 'utf8').matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2]!
      if (specifier.startsWith('.')) queue.push(relative(repo, resolvePath(repo, dirname(file), specifier)).replaceAll('\\', '/'))
      else {
        const entry = bareEntry(specifier)
        if (entry) queue.push(entry)
      }
    }
  }
  for (const name of REQUIRE_RESOLVED) if (!kept.has(runtimeEntry(repo, name, 'require'))) missing.push(runtimeEntry(repo, name, 'require'))
  expect(missing).toEqual([])
  expect(seen.size).toBeGreaterThan(50)
})
