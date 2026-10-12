#!/usr/bin/env bun
/**
 * bun run release [patch|minor|major|current|X.Y.Z] [--yes] [--dry-run] [--skip-checks]
 *
 * One-shot local macOS release: bump version -> checks -> DMG -> verify -> confirm ->
 * push + tag -> GitHub release via `ghp` -> render + push the Cask.
 * Runs on an Apple-silicon Mac (GitHub macOS runner minutes are used up).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { draftReleaseNotes, latestVersionTag, resolveReleaseVersion, setPackageVersion } from './release-version.ts'

const REPO = 'PylotLight/Surffish'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name: string): boolean => args.includes(name)
const spec = args.find((arg) => !arg.startsWith('-')) ?? 'patch'
const yes = flag('--yes') || flag('-y')
const dryRun = flag('--dry-run')
const skipChecks = flag('--skip-checks')

if (flag('--help') || flag('-h')) {
  console.log(`usage: bun run release [patch|minor|major|current|X.Y.Z] [--yes] [--dry-run] [--skip-checks]

  patch (default)  bump X.Y.Z -> X.Y.(Z+1) from the latest tag / package.json
  minor, major     the usual
  current          release package.json's version as-is (already bumped, not tagged yet)
  X.Y.Z            release exactly this version

  --dry-run        bump + build + verify locally, publish nothing, then undo the bump commit
  --yes            don't ask before publishing
  --skip-checks    skip typecheck + tests

release notes come from docs/releases/vX.Y.Z.md; if it's missing a draft is written from
commits since the last tag and the script stops so you can edit it.
GitHub calls go through your fish \`ghp\` function (set SURFFISH_GH=gh to use plain gh).`)
  process.exit(0)
}

const log = (message: string): void => console.log(`\x1b[36m[release]\x1b[0m ${message}`)
function fail(message: string): never {
  console.error(`\x1b[31m[release] error:\x1b[0m ${message}`)
  process.exit(1)
}

function run(cmd: string, cmdArgs: string[], opts: { capture?: boolean; allowFail?: boolean } = {}): string {
  const result = spawnSync(cmd, cmdArgs, { cwd: root, stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' })
  if (result.status !== 0 && !opts.allowFail) fail(`${cmd} ${cmdArgs.join(' ')} exited ${result.status ?? result.signal}`)
  return (result.stdout ?? '').trim()
}
const git = (...gitArgs: string[]): string => run('git', gitArgs, { capture: true })

/** GitHub CLI via the user's fish `ghp` (personal-account gh wrapper), falling back to SURFFISH_GH. */
function gh(ghArgs: string[]): void {
  const override = process.env.SURFFISH_GH
  if (override) return void run(override, ghArgs)
  run('bash', ['-c', 'source "$0/scripts/fish-ghp.sh" && surffish_ghp "$@"', root, ...ghArgs])
}

async function confirm(question: string): Promise<boolean> {
  if (yes) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`\x1b[33m[release]\x1b[0m ${question} [y/N] `)
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

// ---- preflight -------------------------------------------------------------
if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('run this on an Apple-silicon Mac')
for (const tool of ['git', 'hdiutil', 'shasum']) {
  if (spawnSync('which', [tool]).status !== 0) fail(`missing ${tool}`)
}
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('switch to main first')
if (git('status', '--porcelain')) fail('working tree is dirty, commit or stash first')
log('fetching origin…')
run('git', ['fetch', '--quiet', '--tags', 'origin'])
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main is not in sync with origin/main (pull or push first)')

const packagePath = join(root, 'package.json')
const packageJson = readFileSync(packagePath, 'utf8')
const packageVersion = JSON.parse(packageJson).version as string
const latestTag = latestVersionTag(git('tag', '-l', 'v*').split('\n'))
let version: string
try {
  version = resolveReleaseVersion(spec, packageVersion, latestTag)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
const tag = `v${version}`
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) fail(`${tag} already exists on origin`)
log(`releasing ${tag} (package.json ${packageVersion}, latest tag ${latestTag ?? 'none'})${dryRun ? ' — dry run' : ''}`)

// ---- notes -----------------------------------------------------------------
const notesPath = join(root, 'docs', 'releases', `${tag}.md`)
if (!existsSync(notesPath)) {
  const range = latestTag ? [`${latestTag}..HEAD`] : []
  const subjects = git('log', '--format=%s', ...range).split('\n')
  writeFileSync(notesPath, draftReleaseNotes(version, subjects))
  log(`wrote a draft at docs/releases/${tag}.md — tidy it up, commit + push it, then run this again`)
  process.exit(1)
}

// ---- bump + checks + build ------------------------------------------------
const bumped = version !== packageVersion
if (bumped) {
  writeFileSync(packagePath, setPackageVersion(packageJson, version))
  run('git', ['commit', '--quiet', '-m', `chore: release ${tag}`, '--', 'package.json'])
  log(`bumped package.json to ${version} (local commit, not pushed yet)`)
}
const undoBump = (): void => {
  if (bumped) {
    run('git', ['reset', '--quiet', '--hard', 'origin/main'])
    log('undid the local version bump')
  }
}

const step = (label: string, cmd: string, cmdArgs: string[]): void => {
  log(label)
  const result = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    undoBump()
    fail(`${label} failed`)
  }
}

step('bun install', 'bun', ['install'])
if (!skipChecks) {
  step('typecheck', 'bun', ['run', 'typecheck'])
  step('tests', 'bun', ['run', 'test'])
}
step('building DMG', 'bun', ['run', 'dist:mac'])

const dmgName = `Surffish-${version}-mac-arm64.dmg`
const dmg = join(root, 'release', dmgName)
if (!existsSync(dmg)) {
  undoBump()
  fail(`expected ${dmg} after dist:mac`)
}
step('hdiutil verify', 'hdiutil', ['verify', dmg])
const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex')
log(`${dmgName}\n          sha256 ${sha256}`)

if (dryRun) {
  undoBump()
  log(`dry run done, nothing published. DMG is at release/${dmgName}`)
  process.exit(0)
}

if (!(await confirm(`smoke test release/${dmgName} if you want (open it), then publish ${tag}?`))) {
  undoBump()
  log('not published')
  process.exit(1)
}

// ---- publish ---------------------------------------------------------------
if (bumped) run('git', ['push', '--quiet', 'origin', 'main'])
run('git', ['tag', '-a', tag, '-m', `Surffish ${tag}`])
run('git', ['push', '--quiet', 'origin', tag])
log(`pushed ${tag}`)

gh(['release', 'create', tag, dmg, '--repo', REPO, '--title', `Surffish ${tag}`, '--notes-file', notesPath, '--verify-tag'])
log('github release created')

run('bun', ['scripts/render-cask.ts', '--version', version, '--sha256-arm64', sha256, '--out', 'Casks/surffish.rb'])
run('git', ['commit', '--quiet', '-m', `chore(tap): update Surffish Cask to ${tag}`, '--', 'Casks/surffish.rb'])
run('git', ['push', '--quiet', 'origin', 'main'])
log(`cask updated. done: https://github.com/${REPO}/releases/tag/${tag}`)
