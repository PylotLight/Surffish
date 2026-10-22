"use strict";

// Sandboxed preload for the built-in Reader view page (surffish-reader://reader/). It can only ask
// main for the article of the tab it was opened for, save the display settings, go back to the page
// and start Read Aloud. No file system, no URLs, no other IPC.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("surffishReader", {
  load: () => ipcRenderer.invoke("reader:load"),
  setSettings: (settings) =>
    ipcRenderer.invoke("reader:settings:set", settings),
  back: () => ipcRenderer.send("reader:back"),
  // Read Aloud (when on in Settings): start/stop reading this article; the sentence being spoken.
  readAloud: () => ipcRenderer.send("reader:read-aloud"),
  onReadAloud: (callback) => {
    ipcRenderer.on("reader:read-aloud", (_event, sentence) =>
      callback(sentence),
    );
  },
  onSettings: (callback) => {
    ipcRenderer.on("reader:settings", (_event, settings) => callback(settings));
  },
});
