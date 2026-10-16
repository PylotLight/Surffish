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
  // Floating header (a panel outside the window): press and release of a drag that moves the window.
  dragHeader: (active) => ipcRenderer.send('mini-window:header-drag', Boolean(active)),
  // Tab strip (grouping 'tabs').
  activateTab: (tabId) => ipcRenderer.send('mini-window:activate-tab', String(tabId)),
  closeTab: (tabId) => ipcRenderer.send('mini-window:close-tab', String(tabId)),
  returnAll: () => ipcRenderer.send('mini-window:return-all'),
  // Speaker (header / strip chip): tab volume 0..1 and mute.
  setVolume: (tabId, volume) => ipcRenderer.send('mini-window:set-volume', String(tabId), Number(volume)),
  setMuted: (tabId, muted) => ipcRenderer.send('mini-window:set-muted', String(tabId), Boolean(muted)),
  tabOut: (tabId, x, y) => ipcRenderer.send('mini-window:tab-out', String(tabId), Number(x), Number(y)),
  // A strip chip drag: 'start' / 'move' (screen point) / 'cancel'; let go on the strip: moveTab (before slot).
  tabDrag: (phase, tabId, x, y) => ipcRenderer.send('mini-window:tab-drag', String(phase), String(tabId), Number(x), Number(y)),
  moveTab: (tabId, slot) => ipcRenderer.send('mini-window:move-tab', String(tabId), Math.round(Number(slot))),
  stepTab: (tabId, step) => ipcRenderer.send('mini-window:step-tab', String(tabId), step < 0 ? -1 : 1),
  stripLayout: (layout) => ipcRenderer.send('mini-window:strip-layout', layout),
  onDropHint: (callback) => ipcRenderer.on('mini-window:drop-hint', (_event, hint) => callback(hint)),
  onTabDragCancel: (callback) => ipcRenderer.on('mini-window:tab-drag-cancel', () => callback()),
  // Dock handle.
  onHandleState: (callback) => ipcRenderer.on('mini-window:handle-state', (_event, state) => callback(state)),
  handleClick: () => ipcRenderer.send('mini-window:handle-click'),
  handleDrag: (active) => ipcRenderer.send('mini-window:handle-drag', Boolean(active)),
  handleHover: (inside) => ipcRenderer.send('mini-window:handle-hover', Boolean(inside)),
  // The mini window's menu (right-click on the header or handle), and the menu bar (Send to / Float, Pin).
  menu: () => ipcRenderer.send('mini-window:menu'),
  handleMenu: () => ipcRenderer.send('mini-window:handle-menu'),
  menuBar: () => ipcRenderer.send('mini-window:menubar'),
  pin: () => ipcRenderer.send('mini-window:pin'),
  // The menu bar popout's strip: its ⋯ menu at (x, y) in the window, and word that it closed.
  more: (x, y) => ipcRenderer.send('mini-window:more', Number(x), Number(y)),
  onMenuClosed: (callback) => ipcRenderer.on('mini-window:menu-closed', () => callback())
})
