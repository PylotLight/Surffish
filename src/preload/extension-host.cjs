// Sandboxed CommonJS preload for Chrome Web Store extension popups and options tabs.
// The extension compatibility shim uses this narrow bridge for chrome.tabs and openOptionsPage;
// the main process re-checks that every call comes from a loaded extension's own page.
const { contextBridge, ipcRenderer } = require('electron')

if (globalThis.location && globalThis.location.protocol === 'chrome-extension:') {
  contextBridge.exposeInMainWorld('surffishExtensionHost', Object.freeze({
    tabs: (op, payload) => ipcRenderer.invoke('browser:extensions:host-tabs', op, payload),
    openOptionsPage: () => ipcRenderer.invoke('browser:extensions:host-options')
  }))
}
