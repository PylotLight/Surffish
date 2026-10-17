// Electron sandboxed preloads must be CommonJS. Narrow bridge for the feedback
// window only — the main process owns the network call and the gateway URL.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('surffishFeedback', Object.freeze({
  submit: (payload) => ipcRenderer.invoke('browser:feedback:submit', payload),
  openIssue: (url) => ipcRenderer.invoke('browser:feedback:open', url)
}))
