'use strict'

// Sandboxed preload for the tab overview page. Only exposes the handful of messages it needs.
const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  ipcRenderer.on(channel, (_event, payload) => callback(payload))
}

contextBridge.exposeInMainWorld('tabOverview', {
  onShow: (callback) => subscribe('tab-overview:show', callback),
  onProgress: (callback) => subscribe('tab-overview:progress', callback),
  onSettle: (callback) => subscribe('tab-overview:settle', callback),
  onItems: (callback) => subscribe('tab-overview:items', callback),
  ready: () => ipcRenderer.send('tab-overview:ready'),
  settled: (open) => ipcRenderer.send('tab-overview:settled', Boolean(open)),
  activate: (id) => ipcRenderer.send('tab-overview:activate', String(id)),
  closeTab: (id) => ipcRenderer.send('tab-overview:close-tab', String(id)),
  newTab: () => ipcRenderer.send('tab-overview:new-tab'),
  dismiss: () => ipcRenderer.send('tab-overview:dismiss')
})
