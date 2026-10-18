'use strict'

// Sandboxed preload for the built-in PDF editor page (surffish-pdf://editor/). It can only ask main
// for the PDF the tab was showing, hand back the edited bytes for a native Save dialog, report
// unsaved changes, manage the user's saved signatures and go back to the viewer. No file system, no
// URLs, no other IPC.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('surffishPdf', {
  load: () => ipcRenderer.invoke('pdf-editor:load'),
  save: (bytes, options) => {
    if (!(bytes instanceof Uint8Array)) return Promise.reject(new Error('Expected PDF bytes.'))
    return ipcRenderer.invoke('pdf-editor:save', bytes, { saveAs: Boolean(options && options.saveAs) })
  },
  signatures: {
    list: () => ipcRenderer.invoke('pdf-editor:signatures:list'),
    add: (signature) => ipcRenderer.invoke('pdf-editor:signatures:add', signature),
    remove: (id) => ipcRenderer.invoke('pdf-editor:signatures:remove', String(id))
  },
  setDirty: (dirty) => ipcRenderer.send('pdf-editor:dirty', Boolean(dirty)),
  backToViewer: () => ipcRenderer.send('pdf-editor:back'),
  onCommand: (callback) => {
    ipcRenderer.on('pdf-editor:command', (_event, command) => {
      if (command === 'save' || command === 'undo' || command === 'redo') callback(command)
    })
  }
})
