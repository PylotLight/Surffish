// Packaged app payload for the perf check (bundle.appPayload / bundle.appFiles). Unit-tested in app-payload.test.ts.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What electron-builder packs into app.asar, approximated: build.files under the app (out/**, package.json)
 * plus the production dependency closure from node_modules, minus the build.files `!` patterns. Bytes and
 * file count. Deterministic: a dependency moved to `dependencies`, a stray sourcemap or a big asset shows here.
 */
export function appPayload(dir: string): { appPayload: number; appFiles: number } {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const patterns: string[] = pkg.build?.files ?? ['out/**/*', 'package.json']
  const include = patterns.filter((p) => !p.startsWith('!')).map((p) => new Bun.Glob(p))
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => new Bun.Glob(p.slice(1)))
  const files: string[] = []
  for (const g of include) for (const f of g.scanSync({ cwd: dir, onlyFiles: true, dot: true })) files.push(f)
  const seen = new Set<string>()
  const walk = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    const root = join(dir, 'node_modules', name)
    if (!existsSync(join(root, 'package.json'))) return
    for (const f of new Bun.Glob('**/*').scanSync({ cwd: root, onlyFiles: true, dot: true })) files.push(`node_modules/${name}/${f}`)
    const dep = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const d of [...Object.keys(dep.dependencies ?? {}), ...Object.keys(dep.optionalDependencies ?? {})]) walk(d)
  }
  for (const d of Object.keys(pkg.dependencies ?? {})) walk(d)
  const kept = [...new Set(files)].filter((f) => !exclude.some((g) => g.match(f)))
  return { appPayload: kept.reduce((n, f) => n + statSync(join(dir, f)).size, 0), appFiles: kept.length }
}

