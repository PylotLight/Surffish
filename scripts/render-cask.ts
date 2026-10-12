import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = join(root, 'Casks', 'surffish.rb.tmpl')

function fail(message: string): never {
  console.error(`[render-cask] error: ${message}`)
  process.exit(1)
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index < 0 ? undefined : process.argv[index + 1]
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    'Usage: bun scripts/render-cask.ts --version X.Y.Z --sha256-arm64 HEX [--out PATH]'
  )
  console.log('Without --out, prints the rendered cask to stdout.')
  process.exit(0)
}

const version = argValue('--version')
const shaArm64 = argValue('--sha256-arm64')
const output = argValue('--out')

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`--version is required and must be semver, got '${version}'`)
}
const sha256Pattern = /^[0-9a-f]{64}$/
if (!shaArm64 || !sha256Pattern.test(shaArm64)) {
  fail('--sha256-arm64 must be a lowercase 64-character SHA-256 hex digest')
}

const cask = readFileSync(templatePath, 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{SHA256_ARM64}}', shaArm64)

if (cask.includes('{{')) fail('template still has unfilled placeholders')

if (output) {
  const outputPath = resolve(output)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, cask, 'utf8')
  console.log(`[render-cask] wrote ${outputPath}`)
} else {
  process.stdout.write(cask)
}
