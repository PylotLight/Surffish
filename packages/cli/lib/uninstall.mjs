// --uninstall / --uninstall --all: remove the launcher's cache, list (or delete) what the app itself
// left behind. Generic: the paths, keychain items and notes come from config.uninstall.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { cacheRoot, tildify } from './core.mjs'

/** @typedef {import('./types.mjs').AppConfig} AppConfig */

/** "~/x" -> "<home>/x"; absolute paths unchanged; anything else -> null. */
export function expandHome(path, home = homedir()) {
  if (typeof path !== 'string' || !path) return null
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return isAbsolute(path) ? normalize(path) : null
}

/**
 * Whether a path is safe to delete for this app: strictly inside `home`, not a well-known parent
 * folder itself, and naming the app (its id, display name or bundle id) in its last segment.
 * @param {AppConfig} config
 */
export function isSafeToDelete(config, path, home = homedir()) {
  if (typeof path !== 'string' || !isAbsolute(path) || !home || home === '/') return false
  const p = normalize(path)
  if (!p.startsWith(home + sep) || p.includes(`${sep}..${sep}`)) return false
  const last = (p.split(sep).pop() ?? '').toLowerCase()
  const names = [config.id, config.displayName, config.uninstall?.bundleId].filter(Boolean).map((s) => String(s).toLowerCase())
  return names.some((n) => last.includes(n))
}

/**
 * What --uninstall touches. Pure apart from `exists`, so tests can run it on a temp home.
 * @param {AppConfig} config
 * @param {{ env?: Record<string, string | undefined>, home?: string, exists?: (p: string) => boolean }} [opts]
 */
export function uninstallPlan(config, { env = process.env, home = homedir(), exists = existsSync } = {}) {
  const u = config.uninstall ?? {}
  const cache = cacheRoot(config, env, home)
  const data = (u.userData ?? []).map((entry) => {
    const path = expandHome(entry.path, home)
    return { path: path ?? entry.path, what: entry.what ?? '', exists: Boolean(path && exists(path)), safe: Boolean(path && isSafeToDelete(config, path, home)) }
  })
  return {
    cache: { path: cache, exists: exists(cache) },
    data,
    keychain: (u.keychain ?? []).map((k) => ({ ...k })),
    notes: [...(u.notes ?? [])],
  }
}

/** The shell lines that remove one keychain item / one preferences domain. */
export function keychainCommand(item) {
  return `security delete-generic-password -s ${shellQuote(item.service)}`
}
/** ~/plain/path, or "$HOME/with spaces" (works in bash, zsh and fish). */
export function shellPath(path, home = homedir()) {
  const inHome = home && path.startsWith(home + '/')
  const rest = inHome ? path.slice(home.length + 1) : path
  if (/^[\w@%+=:,./-]+$/.test(rest)) return inHome ? `~/${rest}` : rest
  return inHome ? `"$HOME/${rest.replace(/(["$`\\])/g, '\\$1')}"` : shellQuote(rest)
}
export function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`
}

/**
 * The "here's what's left" text. `removed` lists data paths already deleted (for --all).
 * @param {AppConfig} config
 * @param {ReturnType<typeof uninstallPlan>} plan
 * @param {{ home?: string, purged?: boolean, keychainFound?: Record<string, boolean> }} [opts]
 */
export function leftoversText(config, plan, { home = homedir(), purged = false, keychainFound = {} } = {}) {
  const t = (p) => tildify(p, home)
  const pkg = config.packageName
  const lines = []
  const found = plan.data.filter((d) => d.exists)
  if (!purged) {
    if (found.length) {
      lines.push(`${config.displayName}'s own data is still here (settings, profile, logins):`)
      for (const d of found) lines.push(`  ${t(d.path)}${d.what ? `   ${d.what}` : ''}`)
      lines.push('remove it with:')
      lines.push(`  rm -rf ${found.map((d) => shellPath(d.path, home)).join(' \\\n         ')}`)
    } else {
      lines.push(`no ${config.displayName} app data found`)
    }
    const kc = plan.keychain.filter((k) => keychainFound[k.service] !== false)
    if (kc.length) {
      lines.push('keychain item' + (kc.length > 1 ? 's' : '') + ' (delete in Keychain Access, or run):')
      for (const k of kc) lines.push(`  ${keychainCommand(k)}${k.what ? `   # ${k.what}` : ''}`)
    }
    if (found.length || kc.length) lines.push(`or let the launcher delete all of that: bunx ${pkg} --uninstall --all`)
  }
  lines.push('bun / npm also keep a copy of this launcher package (a few KB):')
  lines.push(`  bun pm cache rm                       # clears bun's whole package cache, not just ${pkg}`)
  lines.push('  rm -rf ~/.npm/_npx                    # if you ran it with npx')
  lines.push(`  bun remove -g ${pkg}    # only if you installed it globally`)
  for (const n of plan.notes) lines.push(n)
  return lines.join('\n')
}

/** pgrep -x <name>. Unknown (no pgrep, no name) counts as not running. */
export function isProcessRunning(name, platform = process.platform) {
  if (!name || platform === 'win32') return false
  const r = spawnSync('pgrep', ['-x', name], { stdio: 'ignore' })
  return r.status === 0
}

/** Whether a generic-password item exists, without reading its secret. null when unknown. */
export function keychainItemExists(service, platform = process.platform) {
  if (platform !== 'darwin') return null
  const r = spawnSync('security', ['find-generic-password', '-s', service], { stdio: 'ignore' })
  if (r.error) return null
  return r.status === 0
}

/** y/N on a TTY. Non-interactive stdin answers no. */
export async function askYesNo(question, { stdin = process.stdin, stderr = process.stderr } = {}) {
  if (!stdin.isTTY) return false
  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: stdin, output: stderr })
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve))
    return /^y(es)?$/i.test(String(answer).trim())
  } finally {
    rl.close()
  }
}

/**
 * @param {AppConfig} config
 * @param {{ all: boolean, yes: boolean, env: Record<string, string | undefined>, platform: string,
 *   ui: any, stdout: { write(s: string): unknown }, home?: string,
 *   isRunning?: () => boolean, confirm?: (q: string) => Promise<boolean>,
 *   keychainExists?: (service: string) => boolean | null, exec?: (cmd: string, args: string[]) => number | null,
 *   dirSize?: (p: string) => number, formatBytes?: (n: number) => string }} o
 * @returns {Promise<number>}
 */
export async function runUninstall(config, o) {
  const home = o.home ?? homedir()
  const t = (p) => tildify(p, home)
  const u = config.uninstall ?? {}
  const isRunning = o.isRunning ?? (() => isProcessRunning(u.processName ?? config.displayName, o.platform))
  const confirm = o.confirm ?? ((q) => askYesNo(q))
  const keychainExists = o.keychainExists ?? ((s) => keychainItemExists(s, o.platform))
  const exec = o.exec ?? ((cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status)
  const size = o.dirSize ?? (() => NaN)
  const fmt = o.formatBytes ?? ((n) => `${n} bytes`)

  if (isRunning()) {
    o.ui.error(`${config.displayName} is running. Quit it first (⌘Q), then run this again.`)
    return 1
  }

  const plan = uninstallPlan(config, { env: o.env, home })
  const keychainFound = Object.fromEntries(plan.keychain.map((k) => [k.service, keychainExists(k.service)]))

  if (o.all) {
    const targets = plan.data.filter((d) => d.exists)
    const kc = plan.keychain.filter((k) => keychainFound[k.service] === true)
    if (targets.length || kc.length) {
      o.ui.line(`this deletes ${config.displayName}'s data for good (bookmarks, history, logins, settings):`)
      for (const d of targets) o.ui.line(`  ${t(d.path)}`)
      for (const k of kc) o.ui.line(`  keychain: ${k.service}`)
      if (!o.yes) {
        const ok = await confirm('delete all of it?')
        if (!ok) { o.ui.warn('nothing deleted (pass --yes to skip this question)'); return 1 }
      }
    }
  }

  // the launcher's own download cache
  const root = plan.cache.path
  if (root === '/' || root === home || !root.includes(config.id)) { o.ui.error(`refusing to delete ${root}`); return 1 }
  if (plan.cache.exists) {
    const bytes = size(root)
    rmSync(root, { recursive: true, force: true })
    o.ui.step(`removed the launcher cache ${t(root)}${Number.isFinite(bytes) ? ` (${fmt(bytes)})` : ''}`)
  } else {
    o.ui.step(`launcher cache ${t(root)} is already gone`)
  }

  if (o.all) {
    if (o.platform === 'darwin' && u.bundleId) exec('defaults', ['delete', u.bundleId]) // flushes cfprefsd's copy too
    for (const d of plan.data) {
      if (!d.exists) continue
      if (!d.safe) { o.ui.warn(`skipped ${t(d.path)} (doesn't look like ${config.displayName}'s, delete it by hand)`); continue }
      rmSync(d.path, { recursive: true, force: true })
      o.ui.step(`removed ${t(d.path)}`)
    }
    for (const k of plan.keychain) {
      if (keychainFound[k.service] !== true) continue
      const status = o.platform === 'darwin' ? exec('security', ['delete-generic-password', '-s', k.service]) : null
      if (status === 0) o.ui.step(`removed keychain item "${k.service}"`)
      else o.ui.warn(`couldn't remove keychain item "${k.service}": ${keychainCommand(k)}`)
    }
  }

  o.stdout.write(leftoversText(config, plan, { home, purged: o.all, keychainFound }) + '\n')
  return 0
}
