"use strict";

// Sandboxed preload for the Glance header/backdrop page (main/glance-page.ts). Only the handful of
// messages it needs; the remote page inside the glance never gets this bridge.
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld("glance", {
  onLayout: (callback) => subscribe("glance:layout", callback),
  onState: (callback) => subscribe("glance:state", callback),
  close: () => ipcRenderer.send("glance:close"),
  promote: () => ipcRenderer.send("glance:promote"),
  split: () => ipcRenderer.send("glance:split"),
  back: () => ipcRenderer.send("glance:back"),
});
