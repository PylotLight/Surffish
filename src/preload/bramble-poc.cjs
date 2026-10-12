// Electron sandboxed preloads must be CommonJS. Keep this bridge deliberately narrow to Bramble UI operations.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('surffishBramble', Object.freeze({
  openOptionsPage: () => ipcRenderer.invoke('browser:bramble:open-options-from-ui'),
  writeClipboard: (text) => ipcRenderer.invoke('browser:bramble:clipboard-write', text),
  // Only honoured from Bramble's hidden offscreen page (see ipc.ts).
  openPopout: (url) => ipcRenderer.invoke('browser:bramble:popout-open', url),
  closePopout: () => ipcRenderer.invoke('browser:bramble:popout-close')
}))
