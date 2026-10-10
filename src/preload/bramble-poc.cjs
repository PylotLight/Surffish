// Electron sandboxed preloads must be CommonJS. Keep this bridge deliberately narrow: it only lets Bramble UI pages ask Sockfish to open Bramble Setup/Restore.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sockfishBramble', Object.freeze({
  openOptionsPage: () => ipcRenderer.invoke('browser:bramble:open-options-from-ui')
}))
