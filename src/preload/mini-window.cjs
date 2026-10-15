'use strict'

// Sandboxed preload for the mini window's header strip (main/mini-window-page.ts). Only the handful
// of messages it needs; the page in the mini window never gets this bridge.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('miniWindow', {
  onState: (callback) => ipcRenderer.on('mini-window:state', (_event, state) => callback(state)),
  back: () => ipcRenderer.send('mini-window:back'),
  reload: () => ipcRenderer.send('mini-window:reload'),
  returnToBrowser: () => ipcRenderer.send('mini-window:return'),
  close: () => ipcRenderer.send('mini-window:close'),
  hover: (inside) => ipcRenderer.send('mini-window:hover', Boolean(inside))
})
