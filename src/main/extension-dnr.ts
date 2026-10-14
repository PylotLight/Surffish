/**
 * Enforces Chrome Web Store extensions' declarativeNetRequest rules on the profile session.
 *
 * Electron 44 has the DNR API (extensions can call it) and its native engine would enforce rules,
 * but only while the session has no webRequest listeners; Surffish always has them (ad blocker,
 * request gates), so natively nothing is ever blocked. Instead, Surffish evaluates the rules itself
 * (src/shared/dnr.ts) from its single webRequest pipeline:
 *  - onBeforeRequest: a session request gate, run by the ad blocker's handler before the filter
 *    engine (block / redirect / upgradeScheme; allow and allowAllRequests just stop DNR).
 *  - onBeforeSendHeaders / onHeadersReceived: request-gate header hooks (modifyHeaders), installed
 *    only while some extension has such rules.
 *
 * Rule sources: static rulesets read from the extension's files; dynamic and session rules and the
 * enabled-ruleset set as reported by the extension bridge (extension-bridge.ts), which reads them
 * from the native API after the extension changes them. The last known dynamic rules and enabled
 * rulesets are kept in a small state file so the first pages after a restart are filtered before the
 * extension's worker has run.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { Session } from 'electron'
import {
  applyDnrHeaderRules,
  DnrMatcher,
  dnrRedirectUrl,
  dnrResourceType,
  manifestDnrRulesets,
  parseDnrRules,
  type CompiledDnrRule,
  type DnrRequest,
  type DnrRulesetDeclaration,
  type HeaderRecord
} from '../shared/dnr'
import { matchesChromePattern } from '../shared/extension-tabs'
import { addRequestHeadersHook, addResponseHeadersHook, addSessionRequestGate, type RequestGateDetails } from './request-gate'
import { writeJsonAtomic } from './extension-staging'

type JsonRecord = Record<string, unknown>

const MAX_RULESET_BYTES = 32 * 1024 * 1024
const STATE_VERSION = 1

interface StaticRuleset {
  declaration: DnrRulesetDeclaration
  rules: CompiledDnrRule[] | null
  rejected: number
}

interface ExtensionDnr {
  id: string
  version: string
  directory: string
  statePath: string
  hostPatterns: string[]
  /** `declarativeNetRequest` (block/allow/upgrade need no host access) vs only `…WithHostAccess`. */
  needsHostAccessForAll: boolean
  rulesets: Map<string, StaticRuleset>
  enabledRulesets: Set<string>
  disabledStaticRuleIds: Map<string, number[]>
  dynamicRules: unknown[]
  sessionRules: unknown[]
  matcher: DnrMatcher
  rejected: number
}

export interface ExtensionDnrStats {
  extensions: number
  rules: number
  rejectedRules: number
  evaluated: number
  blocked: number
  redirected: number
  allowed: number
  headerRequests: number
  /** Total time spent in the DNR request gate, in microseconds. */
  gateMicroseconds: number
}

const extensions = new Map<string, ExtensionDnr>()
const allowAllByContents = new Map<number, number>()
const stats: ExtensionDnrStats = { extensions: 0, rules: 0, rejectedRules: 0, evaluated: 0, blocked: 0, redirected: 0, allowed: 0, headerRequests: 0, gateMicroseconds: 0 }
let profileSession: Session | null = null
let removeGate: (() => void) | null = null
let removeRequestHeaders: (() => void) | null = null
let removeResponseHeaders: (() => void) | null = null

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** Whether a manifest asks for declarativeNetRequest (and so needs Surffish's enforcement). */
export function manifestUsesDnr(manifest: JsonRecord): boolean {
  const permissions = stringList(manifest.permissions)
  return permissions.includes('declarativeNetRequest') || permissions.includes('declarativeNetRequestWithHostAccess') || manifestDnrRulesets(manifest).length > 0
}

function readRulesetFile(directory: string, path: string): unknown {
  const root = resolve(directory)
  const file = resolve(root, path.replace(/^\/+/, ''))
  if (!file.startsWith(`${root}${sep}`) || !existsSync(file)) throw new Error(`ruleset file ${path} is missing`)
  if (statSync(file).size > MAX_RULESET_BYTES) throw new Error(`ruleset file ${path} is too large`)
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as unknown
}

interface PersistedState {
  version: number
  extensionVersion: string
  enabledRulesets: string[]
  dynamicRules: unknown[]
  disabledStaticRuleIds: Record<string, number[]>
}

function readState(path: string): PersistedState | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(parsed) || parsed.version !== STATE_VERSION) return null
    const disabled: Record<string, number[]> = {}
    if (isRecord(parsed.disabledStaticRuleIds)) {
      for (const [key, value] of Object.entries(parsed.disabledStaticRuleIds)) {
        if (Array.isArray(value)) disabled[key] = value.filter((id): id is number => Number.isInteger(id))
      }
    }
    return {
      version: STATE_VERSION,
      extensionVersion: typeof parsed.extensionVersion === 'string' ? parsed.extensionVersion : '',
      enabledRulesets: stringList(parsed.enabledRulesets),
      dynamicRules: Array.isArray(parsed.dynamicRules) ? parsed.dynamicRules : [],
      disabledStaticRuleIds: disabled
    }
  } catch {
    return null
  }
}

function saveState(entry: ExtensionDnr): void {
  try {
    writeJsonAtomic(entry.statePath, {
      version: STATE_VERSION,
      extensionVersion: entry.version,
      enabledRulesets: [...entry.enabledRulesets],
      dynamicRules: entry.dynamicRules,
      disabledStaticRuleIds: Object.fromEntries(entry.disabledStaticRuleIds)
    } satisfies PersistedState)
  } catch (error) {
    console.warn(`[extensions] could not save declarativeNetRequest state for ${entry.id}:`, error instanceof Error ? error.message : error)
  }
}

function staticRules(entry: ExtensionDnr, ruleset: StaticRuleset): CompiledDnrRule[] {
  if (ruleset.rules) return ruleset.rules
  try {
    const disabled = new Set(entry.disabledStaticRuleIds.get(ruleset.declaration.id) ?? [])
    const parsed = parseDnrRules(readRulesetFile(entry.directory, ruleset.declaration.path), ruleset.declaration.id, 'static', disabled)
    ruleset.rules = parsed.rules
    ruleset.rejected = parsed.rejected.length
    if (parsed.rejected.length > 0) {
      console.warn(`[extensions] ${entry.id}: ${parsed.rejected.length} declarativeNetRequest rule(s) in ${ruleset.declaration.id} can't be enforced, e.g. rule ${String(parsed.rejected[0]?.id)}: ${parsed.rejected[0]?.reason}`)
    }
  } catch (error) {
    ruleset.rules = []
    console.warn(`[extensions] ${entry.id}: could not read declarativeNetRequest ruleset ${ruleset.declaration.id}:`, error instanceof Error ? error.message : error)
  }
  return ruleset.rules
}

function rebuild(entry: ExtensionDnr): void {
  const rules: CompiledDnrRule[] = []
  let rejected = 0
  for (const ruleset of entry.rulesets.values()) {
    if (!entry.enabledRulesets.has(ruleset.declaration.id)) continue
    rules.push(...staticRules(entry, ruleset))
    rejected += ruleset.rejected
  }
  const dynamic = parseDnrRules(entry.dynamicRules, '_dynamic', 'dynamic')
  const session = parseDnrRules(entry.sessionRules, '_session', 'session')
  rules.push(...dynamic.rules, ...session.rules)
  entry.rejected = rejected + dynamic.rejected.length + session.rejected.length
  entry.matcher = new DnrMatcher(rules)
  refreshHooks()
}

function refreshHooks(): void {
  const all = [...extensions.values()]
  stats.extensions = all.length
  stats.rules = all.reduce((sum, entry) => sum + entry.matcher.size, 0)
  stats.rejectedRules = all.reduce((sum, entry) => sum + entry.rejected, 0)
  if (!profileSession) return
  const wantsGate = all.some((entry) => entry.matcher.size > 0)
  if (wantsGate && !removeGate) removeGate = addSessionRequestGate(profileSession, dnrGate)
  if (!wantsGate && removeGate) { removeGate(); removeGate = null }
  const wantsRequestHeaders = all.some((entry) => entry.matcher.hasRequestHeaderRules)
  if (wantsRequestHeaders && !removeRequestHeaders) removeRequestHeaders = addRequestHeadersHook(profileSession, (details, headers) => headerHook(details, headers, 'requestHeaders'))
  if (!wantsRequestHeaders && removeRequestHeaders) { removeRequestHeaders(); removeRequestHeaders = null }
  const wantsResponseHeaders = all.some((entry) => entry.matcher.hasResponseHeaderRules)
  if (wantsResponseHeaders && !removeResponseHeaders) removeResponseHeaders = addResponseHeadersHook(profileSession, (details, headers) => headerHook(details, headers, 'responseHeaders'))
  if (!wantsResponseHeaders && removeResponseHeaders) { removeResponseHeaders(); removeResponseHeaders = null }
}

/** Load (or reload) an extension's rules. `statePath` is where Surffish keeps its DNR state. */
export function registerExtensionDnr(session: Session, id: string, directory: string, manifest: JsonRecord, statePath: string): void {
  profileSession = session
  if (!manifestUsesDnr(manifest)) {
    unregisterExtensionDnr(id)
    return
  }
  const version = typeof manifest.version === 'string' ? manifest.version : ''
  const declarations = manifestDnrRulesets(manifest)
  const saved = readState(statePath)
  const permissions = stringList(manifest.permissions)
  const sameVersion = saved !== null && saved.extensionVersion === version
  const known = new Set(declarations.map((declaration) => declaration.id))
  // Like Chrome: enabled rulesets and disabled static rules reset to the manifest when the extension updates.
  const enabledRulesets = new Set(sameVersion
    ? saved.enabledRulesets.filter((rulesetId) => known.has(rulesetId))
    : declarations.filter((declaration) => declaration.enabled).map((declaration) => declaration.id))
  const entry: ExtensionDnr = {
    id,
    version,
    directory,
    statePath,
    hostPatterns: [...stringList(manifest.host_permissions), ...stringList(manifest.permissions).filter((value) => value.includes('://') || value === '<all_urls>')],
    needsHostAccessForAll: !permissions.includes('declarativeNetRequest'),
    rulesets: new Map(declarations.map((declaration) => [declaration.id, { declaration, rules: null, rejected: 0 }])),
    enabledRulesets,
    disabledStaticRuleIds: new Map(sameVersion ? Object.entries(saved.disabledStaticRuleIds) : []),
    dynamicRules: saved?.dynamicRules ?? [],
    sessionRules: extensions.get(id)?.sessionRules ?? [],
    matcher: new DnrMatcher([]),
    rejected: 0
  }
  extensions.set(id, entry)
  rebuild(entry)
  if (!sameVersion) saveState(entry)
}

export function unregisterExtensionDnr(id: string): void {
  if (!extensions.delete(id)) return
  refreshHooks()
}

export interface ReportedDnrState {
  dynamicRules?: unknown
  sessionRules?: unknown
  enabledRulesets?: unknown
  disabledStaticRuleIds?: unknown
}

/** The extension's rules as read back from the native API (the bridge reports them after every change). */
export function updateExtensionDnrState(id: string, reported: ReportedDnrState): void {
  const entry = extensions.get(id)
  if (!entry) return
  let persist = false
  if (Array.isArray(reported.dynamicRules)) {
    entry.dynamicRules = reported.dynamicRules
    persist = true
  }
  if (Array.isArray(reported.sessionRules)) entry.sessionRules = reported.sessionRules
  if (Array.isArray(reported.enabledRulesets)) {
    entry.enabledRulesets = new Set(stringList(reported.enabledRulesets).filter((rulesetId) => entry.rulesets.has(rulesetId)))
    persist = true
  }
  if (isRecord(reported.disabledStaticRuleIds)) {
    const next = new Map<string, number[]>()
    for (const [rulesetId, ids] of Object.entries(reported.disabledStaticRuleIds)) {
      if (!entry.rulesets.has(rulesetId) || !Array.isArray(ids)) continue
      next.set(rulesetId, ids.filter((value): value is number => Number.isInteger(value)))
    }
    const changed = JSON.stringify([...next].sort()) !== JSON.stringify([...entry.disabledStaticRuleIds].sort())
    if (changed) {
      entry.disabledStaticRuleIds = next
      for (const ruleset of entry.rulesets.values()) ruleset.rules = null
    }
    persist = true
  }
  rebuild(entry)
  if (persist) saveState(entry)
}

/** Static rulesets Surffish has enabled; the bridge mirrors this into the native API on start-up. */
export function extensionDnrEnabledRulesets(id: string): string[] | null {
  const entry = extensions.get(id)
  return entry ? [...entry.enabledRulesets] : null
}

export function getExtensionDnrStats(): ExtensionDnrStats {
  return { ...stats }
}

// ---------------------------------------------------------------------------
// Matching from the webRequest pipeline

function hasHostAccess(entry: ExtensionDnr, url: string | undefined): boolean {
  if (!url) return true
  return entry.hostPatterns.some((pattern) => matchesChromePattern(pattern, url))
}

/** Requests DNR applies to: web (http/ws) requests made by pages, never the browser's or extensions' own. */
function requestFor(details: { url: string; method?: string; resourceType?: string; webContentsId?: number; initiatorOrigin?: string; referrer?: string }): DnrRequest | null {
  if (!/^(?:https?|wss?):/i.test(details.url)) return null
  const initiator = details.initiatorOrigin && details.initiatorOrigin !== 'null' ? details.initiatorOrigin : undefined
  if (initiator && !/^https?:/i.test(initiator)) return null
  const fromPage = typeof details.webContentsId === 'number' && details.webContentsId >= 0
  if (!fromPage && !initiator) return null
  const type = dnrResourceType(details.resourceType)
  const tabId = fromPage ? details.webContentsId as number : -1
  return {
    url: details.url,
    initiator: type === 'main_frame' ? undefined : initiator,
    method: details.method,
    type,
    tabId,
    allowAllRequestsPriority: type === 'main_frame' || tabId < 0 ? undefined : allowAllByContents.get(tabId)
  }
}

function actionAllowed(entry: ExtensionDnr, rule: CompiledDnrRule, request: DnrRequest): boolean {
  const type = rule.action.type
  const needsHostAccess = entry.needsHostAccessForAll || type === 'redirect' || type === 'modifyHeaders'
  if (!needsHostAccess) return true
  if (!hasHostAccess(entry, request.url)) return false
  return request.type === 'main_frame' || hasHostAccess(entry, request.initiator)
}

function dnrGate(details: RequestGateDetails): Electron.CallbackResponse | null {
  const started = process.hrtime.bigint()
  try {
    const request = requestFor(details)
    if (!request) return null
    stats.evaluated += 1
    if (request.type === 'main_frame' && request.tabId !== undefined) allowAllByContents.delete(request.tabId)
    let redirect: string | null = null
    let allowed = false
    for (const entry of extensions.values()) {
      if (entry.matcher.size === 0) continue
      const rule = entry.matcher.match(request).rule
      if (!rule || !actionAllowed(entry, rule, request)) continue
      switch (rule.action.type) {
        case 'block':
          stats.blocked += 1
          return { cancel: true }
        case 'redirect':
        case 'upgradeScheme':
          redirect ??= dnrRedirectUrl(rule, request.url, entry.id)
          break
        case 'allowAllRequests':
          if (request.type === 'main_frame' && request.tabId !== undefined && request.tabId >= 0) {
            allowAllByContents.set(request.tabId, Math.max(rule.priority, allowAllByContents.get(request.tabId) ?? 0))
          }
          allowed = true
          break
        case 'allow':
          allowed = true
          break
        default:
          break
      }
    }
    if (redirect) {
      stats.redirected += 1
      return { redirectURL: redirect }
    }
    if (allowed) stats.allowed += 1
    return null
  } finally {
    stats.gateMicroseconds += Number(process.hrtime.bigint() - started) / 1000
  }
}

function headerHook(details: Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails, headers: HeaderRecord, which: 'requestHeaders' | 'responseHeaders'): HeaderRecord | null {
  const request = requestFor(details)
  if (!request) return null
  let current = headers
  let changed = false
  for (const entry of extensions.values()) {
    if (which === 'requestHeaders' ? !entry.matcher.hasRequestHeaderRules : !entry.matcher.hasResponseHeaderRules) continue
    const match = entry.matcher.match(request)
    const rules = match.headerRules.filter((rule) => actionAllowed(entry, rule, request))
    if (rules.length === 0) continue
    const next = applyDnrHeaderRules(current, rules, which)
    if (next) {
      current = next
      changed = true
    }
  }
  if (changed) stats.headerRequests += 1
  return changed ? current : null
}

/** Drop per-tab allowAllRequests state for a closed tab. */
export function forgetExtensionDnrTab(webContentsId: number): void {
  allowAllByContents.delete(webContentsId)
}

// Smoke instrumentation only (scripts/electron-extension-dnr-smoke.cjs reads the per-request cost).
if (process.env.SURFFISH_SMOKE_DNR_STATS === '1') {
  (globalThis as Record<string, unknown>).__surffishExtensionDnrStats = getExtensionDnrStats
}
