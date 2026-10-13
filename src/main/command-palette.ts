import type { CommandPaletteOpenRequest, CommandPaletteSettings, PaletteMode } from '../shared/command-palette'
import { parseRecentCommandIds, recordRecentCommand } from '../shared/command-palette'
import { readUserJson, writeUserJson } from './user-json'
import { deferWrite } from './deferred-writes'
import { sendToMainWindowRenderers, sendToVisibleShellRenderer } from './browser-shell'

// Kept free of browser.ts imports so browser.ts can call the shortcut hook without a cycle.

const FILE = 'command-palette.json'

interface StoredPalette {
  settings: CommandPaletteSettings
  recent: string[]
}

let stored: StoredPalette | null = null

function load(): StoredPalette {
  if (stored) return stored
  const value = readUserJson(FILE)
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  stored = {
    settings: { enabled: record.enabled !== false },
    recent: parseRecentCommandIds(record.recent)
  }
  return stored
}

function save(): void {
  deferWrite('command-palette', () => {
    const current = load()
    writeUserJson(FILE, { version: 1, enabled: current.settings.enabled, recent: current.recent })
  }, 800)
}

export function getCommandPaletteSettings(): CommandPaletteSettings {
  return { ...load().settings }
}

export function setCommandPaletteSettings(input: unknown): CommandPaletteSettings {
  const current = load()
  if (typeof input === 'object' && input !== null && typeof (input as Record<string, unknown>).enabled === 'boolean') {
    current.settings = { ...current.settings, enabled: (input as { enabled: boolean }).enabled }
    save()
    sendToMainWindowRenderers('browser:command-palette:settings-changed', getCommandPaletteSettings())
  }
  return getCommandPaletteSettings()
}

export function getRecentCommandIds(): string[] {
  return [...load().recent]
}

export function noteCommandUsed(id: string): void {
  const current = load()
  current.recent = recordRecentCommand(current.recent, id)
  save()
}

/** Open the palette in whichever shell surface covers the page (toolbar overlay or New Tab renderer). */
export function openCommandPalette(mode: PaletteMode = 'all'): boolean {
  if (!load().settings.enabled) return false
  const request: CommandPaletteOpenRequest = { mode }
  return sendToVisibleShellRenderer('browser:command-palette:open', request)
}

/**
 * Cmd/Ctrl+K and Cmd/Ctrl+Shift+A from a page's before-input-event (key already lower-cased).
 * Returns false when the palette is turned off so the keys reach the page.
 */
export function handleCommandPaletteShortcut(key: string, shift: boolean, alt: boolean, primary: boolean): boolean {
  if (alt || !primary || !load().settings.enabled) return false
  if (key === 'k' && !shift) return openCommandPalette('all')
  if (key === 'a' && shift) return openCommandPalette('tabs')
  return false
}

