#!/usr/bin/env bun
/**
 * bun run release [patch|minor|major|current|X.Y.Z] [--yes] [--dry-run] [--skip-checks]
 *
 * bun run release X.Y.Z --resume --from-tag [--yes] [--dry-run]
 *
 * One-shot local macOS release: bump version -> checks -> ZIP -> verify -> confirm ->
 * push + tag -> GitHub release (REST via curl over SURFFISH_GH_PROXY, else `ghp`) -> render + push the Cask.
 * Runs on an Apple-silicon Mac (GitHub macOS runner minutes are used up).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { dependencyDifferences, draftReleaseNotes, latestVersionTag, plistString, resolveFromTagVersion, resolveReleaseVersion, setPackageVersion } from './release-version.ts'
import { checkGitHubApi, createGitHubRelease, githubApiConfigFromEnv, type GitHubApiConfig } from './github-api.ts'

const REPO = 'PylotLight/Surffish'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name: string): boolean => args.includes(name)
const spec = args.find((arg) => !arg.startsWith('-')) ?? 'patch'
const yes = flag('--yes') || flag('-y')
const dryRun = flag('--dry-run')
const skipChecks = flag('--skip-checks')
const fromTag = flag('--from-tag')
const resume = flag('--resume') || fromTag

if (flag('--help') || flag('-h')) {
  console.log(`usage: bun run release [patch|minor|major|current|X.Y.Z] [--yes] [--dry-run] [--skip-checks] [--resume]

  patch (default)  bump X.Y.Z -> X.Y.(Z+1) from the latest tag / package.json
  minor, major     the usual
  current          release package.json's version as-is (already bumped, not tagged yet)
  X.Y.Z            release exactly this version

  --dry-run        bump + build + verify locally, publish nothing, then undo the bump commit
  --yes            don't ask before publishing
  --skip-checks    skip typecheck + tests
  --resume         finish a release whose bump + tag already reached origin but whose GitHub
                   release didn't (e.g. the gh upload failed): rebuilds package.json's version,
                   then creates the release and updates the Cask
  --from-tag       with --resume (implied) and an explicit X.Y.Z: build the code at the existing
                   vX.Y.Z tag (detached checkout, reusing main's node_modules, no second install),
                   publish its release with main's docs/releases/vX.Y.Z.md, then update the Cask on main

release notes come from docs/releases/vX.Y.Z.md; if it's missing a draft is written from
commits since the last tag and the script stops so you can edit it.
GitHub calls: with SURFFISH_GH_PROXY set (e.g. socks5h://127.0.0.1:1080) they're REST calls via curl
through that proxy only, using SURFFISH_GH_TOKEN (or GITHUB_TOKEN / GH_TOKEN); --dry-run checks that
route read-only. Without it they go through your fish \`ghp\` function (SURFFISH_GH=gh uses plain gh).`)
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
// git's own network calls (fetch, ls-remote, push) go through SURFFISH_GH_PROXY too when it's set, so a
// runner restarted without HTTP(S)_PROXY in its env still pushes (the Mac's direct route 403s token
// writes). git/libcurl takes socks5h:// etc. Without it git uses HTTPS_PROXY from the env, or goes direct.
const ghProxy = process.env.SURFFISH_GH_PROXY?.trim()
const viaProxy = (gitArgs: string[]): string[] => (ghProxy ? ['-c', `http.https://github.com/.proxy=${ghProxy}`, ...gitArgs] : gitArgs)

let githubApi: GitHubApiConfig | null = null
try {
  githubApi = githubApiConfigFromEnv(process.env, REPO)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

/** Fallback without SURFFISH_GH_PROXY: GitHub CLI via the user's fish `ghp`, or SURFFISH_GH. */
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
for (const tool of ['git', 'unzip']) {
  if (spawnSync('which', [tool]).status !== 0) fail(`missing ${tool}`)
}
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('switch to main first')
if (git('status', '--porcelain')) fail('working tree is dirty, commit or stash first')
log(`fetching origin${ghProxy ? ` (git through ${ghProxy.replace(/\/\/[^/@\s]*@/, '//***@')})` : ''}…`)
run('git', viaProxy(['fetch', '--quiet', '--tags', 'origin']))
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main is not in sync with origin/main (pull or push first)')
if (githubApi) {
  log(`checking the GitHub API through ${githubApi.proxy} (read-only)…`)
  try {
    for (const line of checkGitHubApi(githubApi)) log(`  ${line}`)
  } catch (error) {
    fail(`GitHub API check failed: ${error instanceof Error ? error.message : String(error)}`)
  }
} else {
  log('SURFFISH_GH_PROXY not set: GitHub calls will go through ghp / SURFFISH_GH')
}

const packagePath = join(root, 'package.json')
const packageJson = readFileSync(packagePath, 'utf8')
const packageVersion = JSON.parse(packageJson).version as string
const latestTag = latestVersionTag(git('tag', '-l', 'v*').split('\n'))
let version: string
if (fromTag) {
  try {
    version = resolveFromTagVersion(spec, git('tag', '-l', 'v*').split('\n'))
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
} else if (resume) {
  version = packageVersion
} else {
  try {
    version = resolveReleaseVersion(spec, packageVersion, latestTag)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
const tag = `v${version}`
const tagOnOrigin = Boolean(git(...viaProxy(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])))
if (resume) {
  if (!tagOnOrigin) fail(`--resume needs ${tag} on origin already (package.json says ${version})`)
  if (spawnSync('git', ['merge-base', '--is-ancestor', tag, 'HEAD'], { cwd: root }).status !== 0) {
    const shallow = git('rev-parse', '--is-shallow-repository') === 'true'
    fail(`${tag} isn't on main${shallow ? ' (this clone is shallow: git fetch --unshallow --tags origin main)' : ''}`)
  }
} else if (tagOnOrigin) {
  fail(`${tag} already exists on origin (finish it with --resume)`)
}
log(`releasing ${tag} (package.json ${packageVersion}, latest tag ${latestTag ?? 'none'})${fromTag ? ' — from the tag' : resume ? ' — resuming' : ''}${dryRun ? ' — dry run' : ''}`)

// ---- notes -----------------------------------------------------------------
const notesPath = join(root, 'docs', 'releases', `${tag}.md`)
if (!existsSync(notesPath)) {
  const range = latestTag ? [`${latestTag}..HEAD`] : []
  const subjects = git('log', '--format=%s', ...range).split('\n')
  writeFileSync(notesPath, draftReleaseNotes(version, subjects))
  log(`wrote a draft at docs/releases/${tag}.md — tidy it up, commit + push it, then run this again`)
  process.exit(1)
}
const notes = readFileSync(notesPath, 'utf8')

// ---- bump + checks + build ------------------------------------------------
const bumped = !resume && version !== packageVersion
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

// --from-tag: build the tag's own code. node_modules (ignored) stays from main's install above, so the
// tag's dependencies must match main's; switching back to main happens on any exit.
let builtCommit = git('rev-parse', 'HEAD')
if (fromTag) {
  const tagCommit = git('rev-parse', `${tag}^{commit}`)
  const lockChanged = spawnSync('git', ['diff', '--quiet', tag, 'HEAD', '--', 'bun.lock', '.bun-version'], { cwd: root }).status !== 0
  const depFields = dependencyDifferences(git('show', `${tag}:package.json`), packageJson)
  if (lockChanged || depFields.length) {
    fail(`${tag}'s dependencies differ from main's (${[lockChanged ? 'bun.lock/.bun-version' : '', ...depFields].filter(Boolean).join(', ')}); can't reuse main's node_modules`)
  }
  process.on('exit', () => {
    spawnSync('git', ['checkout', '--quiet', '--force', 'main'], { cwd: root, stdio: 'inherit' })
  })
  run('git', ['checkout', '--quiet', '--detach', tag])
  builtCommit = git('rev-parse', 'HEAD')
  if (builtCommit !== tagCommit) fail(`checked out ${builtCommit}, expected ${tag} = ${tagCommit}`)
  const tagPackageVersion = JSON.parse(readFileSync(packagePath, 'utf8')).version as string
  if (tagPackageVersion !== version) fail(`${tag}'s package.json says ${tagPackageVersion}, expected ${version}`)
  log(`building ${tag} from ${builtCommit} (detached, main's node_modules)`)
}
if (!skipChecks) {
  step('typecheck', 'bun', ['run', 'typecheck'])
  step('tests', 'bun', ['run', 'test'])
}
step('building app zip', 'bun', ['run', 'dist:mac'])

const artifactName = `Surffish-${version}-mac-arm64.zip`
const artifact = join(root, 'release', artifactName)
if (!existsSync(artifact)) {
  undoBump()
  fail(`expected ${artifact} after dist:mac`)
}
step('zip integrity', 'unzip', ['-tq', artifact])
const infoPlist = spawnSync('unzip', ['-p', artifact, 'Surffish.app/Contents/Info.plist'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).stdout ?? ''
const bundleVersion = plistString(infoPlist, 'CFBundleShortVersionString')
if (bundleVersion === null) log('warning: no CFBundleShortVersionString in the zip\'s Info.plist (binary plist?), skipping the version check')
else if (bundleVersion !== version) {
  undoBump()
  fail(`the zip's Info.plist says ${bundleVersion}, expected ${version}`)
} else log(`zip's Surffish.app is ${bundleVersion}, built from ${builtCommit}`)
const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
log(`${artifactName}\n          sha256 ${sha256}`)

if (fromTag) {
  run('git', ['checkout', '--quiet', '--force', 'main'])
  log('back on main')
}

if (dryRun) {
  undoBump()
  log(`dry run done, nothing published. zip is at release/${artifactName}`)
  process.exit(0)
}

if (!(await confirm(`smoke test release/mac-arm64/Surffish.app if you want, then publish ${tag}?`))) {
  undoBump()
  log('not published')
  process.exit(1)
}

// ---- publish ---------------------------------------------------------------
if (bumped) run('git', viaProxy(['push', '--quiet', 'origin', 'main']))
if (!resume) {
  run('git', ['tag', '-a', tag, '-m', `Surffish ${tag}`])
  run('git', viaProxy(['push', '--quiet', 'origin', tag]))
  log(`pushed ${tag}`)
}

if (githubApi) {
  try {
    const created = createGitHubRelease(githubApi, { tag, title: `Surffish ${tag}`, notes, assetPath: artifact, log })
    log(`github release published: ${created.url} (assets: ${created.assets.join(', ')})`)
  } catch (error) {
    fail(`github release: ${error instanceof Error ? error.message : String(error)} — fix it, then run with --resume`)
  }
} else {
  gh(['release', 'create', tag, artifact, '--repo', REPO, '--title', `Surffish ${tag}`, '--notes-file', notesPath, '--verify-tag'])
  log('github release created')
}

run('bun', ['scripts/render-cask.ts', '--version', version, '--sha256-arm64', sha256, '--out', 'Casks/surffish.rb'])
run('git', ['commit', '--quiet', '-m', `chore(tap): update Surffish Cask to ${tag}`, '--', 'Casks/surffish.rb'])
run('git', viaProxy(['push', '--quiet', 'origin', 'main']))
log(`cask updated. done: https://github.com/${REPO}/releases/tag/${tag}`)
