/**
 * Accelerators for app-menu items that aren't in TAB_COMMAND_SHORTCUTS. The app menu and the
 * command registry both read them, so the palette's shortcut labels can't drift from the menu.
 */
export const APP_SHORTCUTS = {
  newTab: "CmdOrCtrl+T",
  // Cmd/Ctrl+Shift+N is New Private Window (as in Chrome), so the private tab moved to Alt.
  newPrivateTab: "CmdOrCtrl+Alt+N",
  newWindow: "CmdOrCtrl+N",
  newPrivateWindow: "CmdOrCtrl+Shift+N",
  reopenClosedTab: "CmdOrCtrl+Shift+T",
  openLocation: "CmdOrCtrl+L",
  editPdf: "CmdOrCtrl+Shift+E",
  savePdf: "CmdOrCtrl+S",
  closeWindow: "CmdOrCtrl+Shift+W",
  /** Handled in handleBrowserShortcut (Cmd/Ctrl+Shift+\); label only. */
  tabOverview: "CmdOrCtrl+Shift+\\",
  commandPalette: "CmdOrCtrl+K",
  /** The Settings tab (shared/settings-tab.ts). */
  settings: "CmdOrCtrl+,",
  tabSearch: "CmdOrCtrl+Shift+A",
  /** Cmd/Ctrl+Shift+R is Hard Reload, so Reader view takes Cmd/Ctrl+Alt+R (Safari's Shift+Cmd+R is taken). */
  readerView: "CmdOrCtrl+Alt+R",
} as const;
