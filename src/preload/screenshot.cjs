'use strict'

// Sandboxed preload for the screenshot overlay page. Only exposes the handful of messages it needs.
const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  ipcRenderer.on(channel, (_event, payload) => callback(payload))
}

function bytesOrNull(value) {
  return value instanceof Uint8Array ? value : null
}

contextBridge.exposeInMainWorld('surffishScreenshot', {
  onShow: (callback) => subscribe('screenshot:show', callback),
  onStatus: (callback) => subscribe('screenshot:status', callback),
  onKey: (callback) => subscribe('screenshot:key', callback),
  ready: () => ipcRenderer.send('screenshot:ready'),
  region: (rect) => ipcRenderer.send('screenshot:region', {
    x: Number(rect && rect.x), y: Number(rect && rect.y), width: Number(rect && rect.width), height: Number(rect && rect.height)
  }),
  visible: () => ipcRenderer.send('screenshot:visible'),
  full: () => ipcRenderer.send('screenshot:full'),
  scrolling: (rect) => ipcRenderer.send('screenshot:scrolling', rect ? {
    x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height)
  } : null),
  scrollDone: () => ipcRenderer.send('screenshot:scroll-done'),
  scrollAuto: (on) => ipcRenderer.send('screenshot:scroll-auto', Boolean(on)),
  onScrollState: (callback) => subscribe('screenshot:scroll-state', callback),
  cancel: () => ipcRenderer.send('screenshot:cancel'),
  previewHover: (hovered) => ipcRenderer.send('screenshot:preview-hover', Boolean(hovered)),
  previewActivity: () => ipcRenderer.send('screenshot:preview-activity'),
  copy: (bytes) => ipcRenderer.send('screenshot:copy', bytesOrNull(bytes)),
  save: (bytes) => ipcRenderer.send('screenshot:save', bytesOrNull(bytes)),
  annotate: (open) => ipcRenderer.send('screenshot:annotate', Boolean(open)),
  update: (bytes) => ipcRenderer.send('screenshot:update', bytesOrNull(bytes))
})
