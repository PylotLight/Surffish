'use strict'

// Sandboxed preload for the built-in Reader view page (surffish-reader://reader/). It can only ask
// main for the article of the tab it was opened for, save the display settings and go back to the
// page. No file system, no URLs, no other IPC.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('surffishReader', {
  load: () => ipcRenderer.invoke('reader:load'),
  setSettings: (settings) => ipcRenderer.invoke('reader:settings:set', settings),
  back: () => ipcRenderer.send('reader:back'),
  onSettings: (callback) => {
    ipcRenderer.on('reader:settings', (_event, settings) => callback(settings))
  }
})
