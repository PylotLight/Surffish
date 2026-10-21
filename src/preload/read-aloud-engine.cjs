'use strict'

// Sandboxed preload for the hidden Read Aloud engine page (surffish-tts://engine/). It only receives
// commands from main, reports playback state back, and asks main for one sentence from the local
// OpenAI-compatible speech server (main checks it is a loopback address). No other IPC.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('surffishReadAloudEngine', {
  onCommand: (callback) => {
    ipcRenderer.on('read-aloud-engine:command', (_event, command) => callback(command))
  },
  send: (event) => ipcRenderer.send('read-aloud-engine:event', event),
  speech: (text) => ipcRenderer.invoke('read-aloud-engine:speech', String(text))
})
