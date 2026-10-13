import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appPayload } from './app-payload.ts'

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
