/**
 * One-line "why did this CI step fail" from its log, for the self-hosted Mac jobs.
 *
 *   bun scripts/ci/failure-reason.ts --step "<step title>" --log <file> [--exit <code>]
 *
 * prints `::error title=<step>::<reason>` (an annotation on the run, which scripts/runner-watch.ts
 * also reads back for the runner terminal) and appends a line to $GITHUB_STEP_SUMMARY.
 * scripts/ci/explain.sh wraps a command with this. Dependency-free, plain erasable TypeScript so
 * `node --experimental-strip-types` can run it too (the GitHub-hosted npm job).
 */
import { appendFileSync, readFileSync } from 'node:fs'

export interface RouteEnv {
  SURFFISH_GH_PROXY?: string
  HTTPS_PROXY?: string
  https_proxy?: string
  [key: string]: string | undefined
}

const MAX_REASON = 220

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
/** "Wed 2026-10-21 3:21 AM AEDT (UTC+11:00) " / "2026-10-21T03:21:55.123Z " runner timestamps */
const TIMESTAMP = /^(?:\w{3} \d{4}-\d\d-\d\d \d{1,2}:\d\d (?:AM|PM) \S+ \(UTC[^)]*\) |\d{4}-\d\d-\d\dT[\d:.]+Z )/

export function cleanLine(line: string | undefined): string {
  return (line ?? '').replace(ANSI, '').replace(TIMESTAMP, '').replace(/^##\[(?:error|warning)\]/, '').trim()
}

/** `scheme://user:pass@host:port` -> `scheme://***@host:port`, so a proxy login never reaches a log. */
export function redactProxy(url: string): string {
  return url.replace(/\/\/[^/@\s]*@/, '//***@')
}

/** Which way git/curl reach github.com on this runner, in words. */
export function describeRoute(env: RouteEnv): string {
  const gh = env.SURFFISH_GH_PROXY?.trim()
  if (gh) return `via SURFFISH_GH_PROXY ${redactProxy(gh)}`
  const https = (env.HTTPS_PROXY || env.https_proxy || '').trim()
  if (https) return `via HTTPS_PROXY ${redactProxy(https)}`
  return 'direct (no proxy)'
}

function hasProxy(env: RouteEnv): boolean {
  return Boolean(env.SURFFISH_GH_PROXY?.trim() || (env.HTTPS_PROXY || env.https_proxy || '').trim())
}

const truncate = (text: string): string => (text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text)

interface Rule {
  test: RegExp
  reason: (match: RegExpMatchArray, env: RouteEnv, lines: string[]) => string
}

/** Ordered: the first rule whose pattern appears anywhere in the log wins. */
const RULES: Rule[] = [
  {
    // git over https: "Permission to X.git denied to github-actions[bot]" / "...returned error: 403"
    test: /Permission to \S+ denied to [^\s.]+|unable to access '[^']*github\.com[^']*': The requested URL returned error: 403/i,
    reason: (_m, env, lines) => {
      const what = /git push/i.test(lines.join('\n')) ? 'push to GitHub' : 'git to GitHub'
      return hasProxy(env)
        ? `${what} 403 even ${describeRoute(env)}: check the proxy reaches github.com and the token has contents: write`
        : `${what} 403: runner not behind proxy (route ${describeRoute(env)}), set SURFFISH_GH_PROXY / HTTPS_PROXY in the runner .env and restart it`
    }
  },
  {
    test: /(?:Failed to connect to|Could not connect to|connect to) (?:127\.0\.0\.1|localhost|::1) port (\d+)|Can't complete SOCKS\d? connection|SOCKS\d?: (?:connection|failed)|proxy (?:connect|handshake)[^\n]*(?:refused|failed|aborted)|Unable to receive initial SOCKS/i,
    reason: (_m, env) => `GitHub proxy unreachable (${describeRoute(env)}): is the SOCKS tunnel on the Mac up?`
  },
  {
    test: /Could not resolve (?:host|proxy): (\S+)/i,
    reason: (m) => `DNS: can't resolve ${(m[1] ?? '').replace(/['"]/g, '')} from the runner (network down / VPN?)`
  },
  {
    test: /(?:returned error|HTTP|status)[: ]+401\b|Bad credentials|Authentication failed for/i,
    reason: () => 'GitHub token rejected (401): the workflow token expired or was never passed'
  },
  {
    test: /UnsupportedProxyProtocol/,
    reason: () => "bun can't use the socks proxy (UnsupportedProxyProtocol): unset HTTP(S)_PROXY for bun install"
  },
  {
    test: /(v\d+\.\d+\.\d+\S*) already exists on origin/,
    reason: (m) => `${m[1] ?? 'the tag'} is already tagged on origin: finish it with resume=true`
  },
  {
    test: /wrote a draft at (docs\/releases\/\S+\.md)/,
    reason: (m) => `release notes missing: commit ${m[1] ?? 'docs/releases/vX.Y.Z.md'} to main first`
  },
  {
    test: /main is not in sync with origin\/main|working tree is dirty/,
    reason: (m) => `checkout not clean: ${m[0]}`
  },
  {
    test: /GitHub API check failed: (.+)/,
    reason: (m, env) => `GitHub API check failed ${describeRoute(env)}: ${cleanLine(m[1])}`
  },
  {
    test: /github release: (.+?)(?: — fix it|$)/m,
    reason: (m) => `creating the GitHub release failed: ${cleanLine(m[1])} (re-run with resume=true)`
  },
  {
    test: /notar(?:y|ize|ization)[^\n]*(?:fail|invalid|error|rejected)[^\n]*/i,
    reason: (m) => `notarization failed: ${cleanLine(m[0])}`
  },
  {
    test: /zip integrity failed|expected \S+\.zip after dist:mac|the zip's Info\.plist says [^\n]+/,
    reason: (m) => `app zip broken or missing after the build: ${cleanLine(m[0])}`
  },
  {
    test: /building app zip failed|⨯ [^\n]+/,
    reason: (m) => `electron-builder failed: ${cleanLine(m[0]).replace(/^⨯\s*/, '')}`
  },
  {
    test: /\(fail\) ([^\n]+)/,
    reason: (m) => `unit test failed: ${cleanLine(m[1]).replace(/\s*\[[\d.]+m?s\]$/, '')}`
  },
  {
    test: /typecheck failed|error TS\d+: [^\n]+/,
    reason: (m) => (m[0]?.startsWith('error TS') ? `typecheck: ${cleanLine(m[0])}` : 'typecheck failed')
  },
  {
    test: /npm (?:ERR!|error) code (E[A-Z0-9]+)[\s\S]*?npm (?:ERR!|error) (?!code)([^\n]+)/,
    reason: (m) => `npm ${m[1]}: ${cleanLine(m[2])}`
  },
  {
    test: /npm (?:ERR!|error) ([^\n]+)/,
    reason: (m) => `npm: ${cleanLine(m[1])}`
  },
  {
    test: /lost communication with the server|runner has received a shutdown signal|The job was not acquired by Runner/i,
    reason: () => 'Mac runner went offline / lost its connection mid-job'
  },
  {
    test: /has exceeded the maximum execution time of (\d+) minutes/i,
    reason: (m) => `timed out after ${m[1] ?? '?'} minutes`
  }
]

const ERRORISH = /error|fatal|failed|denied|refused|cannot|can't|unable/i
const NOISE = /^(?:Process completed with exit code \d+\.?|Error: Process completed with exit code \d+\.?|##\[(?:group|endgroup)\].*)$/

/** Last error-looking line, else the last non-empty line, cleaned. */
export function lastErrorLine(lines: string[]): string | null {
  const cleaned = lines.map(cleanLine).filter((line) => line && !NOISE.test(line))
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const line = cleaned[i]
    if (line && ERRORISH.test(line)) return line
  }
  return cleaned.at(-1) ?? null
}

/** The one-line reason for a failed step's log. */
export function failureReason(log: string, env: RouteEnv = {}, exitCode?: number): string {
  const text = log.replace(ANSI, '')
  const lines = text.split(/\r?\n/)
  for (const rule of RULES) {
    const match = text.match(rule.test)
    if (match) return truncate(rule.reason(match, env, lines))
  }
  const last = lastErrorLine(lines)
  if (last) return truncate(last)
  return exitCode === undefined ? 'failed (no output)' : `exited ${exitCode} (no output)`
}

/** `::error title=…::…` with the workflow-command escaping GitHub expects. */
export function errorAnnotation(title: string, reason: string): string {
  const data = (s: string): string => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  const prop = (s: string): string => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
  return `::error title=${prop(title)}::${data(reason)}`
}

export function summaryLine(title: string, reason: string): string {
  return `- ❌ **${title.replace(/[*_`]/g, '')}**: ${reason}\n`
}

function main(argv: string[]): void {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const title = opt('--step') ?? 'step'
  const logPath = opt('--log')
  const exitRaw = opt('--exit')
  const exitCode = exitRaw === undefined ? undefined : Number(exitRaw)
  let log = ''
  try { if (logPath) log = readFileSync(logPath, 'utf8') } catch { /* empty log */ }
  const reason = failureReason(log, process.env, exitCode)
  console.log(errorAnnotation(title, reason))
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    try { appendFileSync(summary, summaryLine(title, reason)) } catch { /* summary is best effort */ }
  }
}

if (process.argv[1]?.endsWith('failure-reason.ts')) main(process.argv.slice(2))
