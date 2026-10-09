import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inspectPasswordExtensionCompatibility, type PasswordManagerTarget } from '../src/shared/password-extension-compat.ts'

const [targetInput, pathInput] = process.argv.slice(2)
if ((targetInput !== 'bitwarden' && targetInput !== 'bramble') || !pathInput) {
  console.error('Usage: npm run check:password-extension -- <bitwarden|bramble> <unpacked-extension-directory-or-manifest.json>')
  process.exitCode = 2
} else {
  const target = targetInput as PasswordManagerTarget
  const inputPath = resolve(pathInput)
  try {
    const manifestPath = existsSync(inputPath) && statSync(inputPath).isDirectory()
      ? join(inputPath, 'manifest.json')
      : inputPath
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new Error('The manifest root must be a JSON object.')
    }
    const report = inspectPasswordExtensionCompatibility(target, manifest)
    console.log(`${report.extensionName} (Manifest ${report.manifestVersion ?? 'unknown'})`)
    if (report.noDeclaredBlockers) {
      console.log('No declared blockers were detected by this static check. Runtime compatibility is not verified.')
    } else {
      for (const issue of report.issues) console.log(`[${issue.kind}] ${issue.message}`)
      console.log('This package is not ready for end-to-end use in Sockfish; the extension was not loaded or executed.')
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`Could not inspect ${inputPath}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  }
}
