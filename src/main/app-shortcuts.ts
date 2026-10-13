/**
 * Accelerators for app-menu items that aren't in TAB_COMMAND_SHORTCUTS. The app menu and the
 * command registry both read them, so the palette's shortcut labels can't drift from the menu.
 */
export const APP_SHORTCUTS = {
  newTab: 'CmdOrCtrl+T',
  newPrivateTab: 'CmdOrCtrl+Shift+N',
  reopenClosedTab: 'CmdOrCtrl+Shift+T',
  openLocation: 'CmdOrCtrl+L',
  editPdf: 'CmdOrCtrl+Shift+E',
  savePdf: 'CmdOrCtrl+S',
  closeWindow: 'CmdOrCtrl+Shift+W',
  /** Handled in handleBrowserShortcut (Cmd/Ctrl+Shift+\); label only. */
  tabOverview: 'CmdOrCtrl+Shift+\\',
  commandPalette: 'CmdOrCtrl+K',
  tabSearch: 'CmdOrCtrl+Shift+A'
} as const
