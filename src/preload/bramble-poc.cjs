// Electron sandboxed preloads must be CommonJS. Keep this bridge deliberately narrow: it only lets Bramble UI pages ask Surffish to open Bramble Setup/Restore.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('surffishBramble', Object.freeze({
  openOptionsPage: () => ipcRenderer.invoke('browser:bramble:open-options-from-ui')
}))
