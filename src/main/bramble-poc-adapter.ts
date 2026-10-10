import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const BRAMBLE_BROWSER_ALIAS_FILE = 'sockfish-bramble-browser-alias.js'
export const BRAMBLE_BACKGROUND_WORKER_FILE = 'sockfish-bramble-background.js'

export type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convert Bramble's Firefox MV3 event-page build into the Electron MV3 shape.
 * This is intentionally narrow: it refuses arbitrary extensions and only adapts
 * Bramble's known Firefox bundle entry points. It does not emulate browser APIs
 * that Electron does not provide.
 */
export function adaptBrambleFirefoxManifest(input: unknown): JsonRecord {
  if (!isRecord(input) || input.name !== 'Bramble' || input.manifest_version !== 3) {
    throw new Error('Select Bramble’s unpacked Firefox build (Manifest V3, name “Bramble”).')
  }

  const background = record(input.background)
  const scripts = Array.isArray(background.scripts) ? background.scripts : []
  if (background.type !== 'module' || scripts.length !== 1 || scripts[0] !== 'background.js') {
    throw new Error('This POC expects Bramble’s Firefox module background at background.js.')
  }

  const manifest = structuredClone(input) as JsonRecord
  delete manifest.browser_specific_settings

  const adaptedBackground: JsonRecord = { ...background }
  delete adaptedBackground.scripts
  adaptedBackground.service_worker = BRAMBLE_BACKGROUND_WORKER_FILE
  adaptedBackground.type = 'module'
  manifest.background = adaptedBackground

  // `identity` is only used by Bramble's optional Google Drive OAuth backup flow.
  // It is not available in Electron and is not required for local vault setup/unlock.
  if (Array.isArray(manifest.permissions)) {
    manifest.permissions = manifest.permissions.filter((permission) => permission !== 'identity')
  }
  const optionalPermissions = manifest.optional_permissions
  if (Array.isArray(optionalPermissions)) {
    const filteredOptionalPermissions = optionalPermissions.filter((permission) => permission !== 'identity')
    if (filteredOptionalPermissions.length === 0) delete manifest.optional_permissions
    else manifest.optional_permissions = filteredOptionalPermissions
  }

  const action = record(manifest.action)
  if (Object.hasOwn(action, 'theme_icons')) {
    delete action.theme_icons
    manifest.action = action
  }

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = manifest.content_scripts.map((entry) => {
      if (!isRecord(entry) || entry.world === 'MAIN' || !Array.isArray(entry.js)) return entry
      const js = entry.js.filter((file): file is string => typeof file === 'string')
      return {
        ...entry,
        js: js.includes(BRAMBLE_BROWSER_ALIAS_FILE) ? js : [BRAMBLE_BROWSER_ALIAS_FILE, ...js]
      }
    })
  }

  return manifest
}

/** Install `browser` as a compatibility alias only in extension-owned contexts. */
export const BRAMBLE_BROWSER_ALIAS_SOURCE = `(() => {
  if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
    Object.defineProperty(globalThis, 'browser', {
      configurable: true,
      enumerable: true,
      value: globalThis.chrome
    });
  }
  const extensionApi = globalThis.browser;
  if (typeof globalThis.document === 'undefined' && extensionApi && typeof extensionApi.offscreen === 'undefined') {
    try {
      Object.defineProperty(extensionApi, 'offscreen', {
        configurable: true,
        value: {
          Reason: { WORKERS: 'WORKERS', CLIPBOARD: 'CLIPBOARD', WEB_RTC: 'WEB_RTC' },
          hasDocument: async () => true,
          createDocument: async () => {}
        }
      });
    } catch {}
  }
})();
`

/** Ensure the alias runs before ESM code in a Bramble-owned HTML page. */
export function injectBrambleBrowserAlias(html: string): string {
  const script = `<script src="./${BRAMBLE_BROWSER_ALIAS_FILE}"></script>`
  if (html.includes(BRAMBLE_BROWSER_ALIAS_FILE)) return html
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, `  ${script}\n</head>`)
  if (/<body\b[^>]*>/i.test(html)) return html.replace(/<body\b[^>]*>/i, (body) => `${body}\n  ${script}`)
  return `${script}\n${html}`
}

export const BRAMBLE_BACKGROUND_WORKER_SOURCE = `import './${BRAMBLE_BROWSER_ALIAS_FILE}';
import './background.js';
`

function listHtmlFiles(directory: string): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...listHtmlFiles(path))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) paths.push(path)
  }
  return paths
}

/**
 * Copy the Firefox build to an app-owned location, adapt only the copy, and return
 * the manifest version. Source files in the Bramble checkout remain untouched.
 */
export function stageBrambleFirefoxBuild(sourceDirectory: string, targetDirectory: string): { stagedDirectory: string; version: string } {
  const source = resolve(sourceDirectory)
  const manifestPath = join(source, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error('The selected folder does not contain manifest.json.')

  let sourceManifest: unknown
  try {
    sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Bramble manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const adaptedManifest = adaptBrambleFirefoxManifest(sourceManifest)
  const action = record(adaptedManifest.action)
  const popupPath = action.default_popup
  const version = typeof adaptedManifest.version === 'string' ? adaptedManifest.version : 'unknown'
  if (typeof popupPath !== 'string' || !existsSync(join(source, popupPath))) {
    throw new Error('The selected Bramble build is missing its declared popup page.')
  }
  if (!existsSync(join(source, 'background.js'))) {
    throw new Error('The selected Bramble build is missing background.js.')
  }
  const hostPatterns = Array.isArray(adaptedManifest.host_permissions) ? adaptedManifest.host_permissions : []
  if (!hostPatterns.includes('<all_urls>')) {
    throw new Error('This POC expects Bramble’s declared <all_urls> host access to be visible before loading.')
  }

  const stagedDirectory = resolve(targetDirectory)
  rmSync(stagedDirectory, { recursive: true, force: true })
  mkdirSync(stagedDirectory, { recursive: true })
  cpSync(source, stagedDirectory, { recursive: true, dereference: false })
  writeFileSync(join(stagedDirectory, 'manifest.json'), `${JSON.stringify(adaptedManifest, null, 2)}\n`)
  writeFileSync(join(stagedDirectory, BRAMBLE_BROWSER_ALIAS_FILE), BRAMBLE_BROWSER_ALIAS_SOURCE)
  writeFileSync(join(stagedDirectory, BRAMBLE_BACKGROUND_WORKER_FILE), BRAMBLE_BACKGROUND_WORKER_SOURCE)
  for (const htmlPath of listHtmlFiles(stagedDirectory)) {
    const html = readFileSync(htmlPath, 'utf8')
    const adapted = injectBrambleBrowserAlias(html)
    if (adapted !== html) writeFileSync(htmlPath, adapted)
  }
  return { stagedDirectory, version }
}
