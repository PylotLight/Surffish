'use strict'

// Sandboxed preload for the mini window's header strip (main/mini-window-page.ts) and its dock
// handle (main/mini-window-handle-page.ts). Only the handful of messages they need; the page in the
// mini window never gets this bridge.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('miniWindow', {
  onState: (callback) => ipcRenderer.on('mini-window:state', (_event, state) => callback(state)),
  back: () => ipcRenderer.send('mini-window:back'),
  reload: () => ipcRenderer.send('mini-window:reload'),
  returnToBrowser: () => ipcRenderer.send('mini-window:return'),
  close: () => ipcRenderer.send('mini-window:close'),
  hover: (inside) => ipcRenderer.send('mini-window:hover', Boolean(inside)),
  tuck: () => ipcRenderer.send('mini-window:tuck'),
  // Tab strip (grouping 'tabs').
  activateTab: (tabId) => ipcRenderer.send('mini-window:activate-tab', String(tabId)),
  closeTab: (tabId) => ipcRenderer.send('mini-window:close-tab', String(tabId)),
  returnAll: () => ipcRenderer.send('mini-window:return-all'),
  tabOut: (tabId, x, y) => ipcRenderer.send('mini-window:tab-out', String(tabId), Number(x), Number(y)),
  // Dock handle.
  onHandleState: (callback) => ipcRenderer.on('mini-window:handle-state', (_event, state) => callback(state)),
  handleClick: () => ipcRenderer.send('mini-window:handle-click'),
  handleDrag: (active) => ipcRenderer.send('mini-window:handle-drag', Boolean(active)),
  handleHover: (inside) => ipcRenderer.send('mini-window:handle-hover', Boolean(inside))
})
