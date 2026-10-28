// Sandboxed CommonJS service-worker preload (session.registerPreloadScript type 'service-worker').
// Gives a Chrome Web Store extension's service worker a direct IPC channel to Surffish's main
// process, so webNavigation events, webNavigation.getFrame/getAllFrames and declarativeNetRequest
// state no longer need the hidden per-extension bridge page (main/extension-bridge.ts).
//
// It runs in the preload realm of every service worker in the browser session, before the worker's
// own script. Website service workers get nothing (one location check). Extension workers get a
// narrow `surffishExtensionWorker` object; main re-checks every message against the worker's scope
// and ignores workers of extensions it does not manage (e.g. Bramble), so exposing it is harmless.
// Chromium only applies service-worker preloads when the renderer sandbox is on; with --no-sandbox
// this file never runs and Surffish falls back to the bridge page.
const { contextBridge, ipcRenderer } = require("electron");

const UP = "surffish:extension-worker:up";
const CALL = "surffish:extension-worker:call";
const DOWN = "surffish:extension-worker:down";
const MAX_EARLY = 200;

let href;
try {
  href = String(
    contextBridge.executeInMainWorld({
      func: () =>
        String((globalThis.location && globalThis.location.href) || ""),
    }) || "",
  );
} catch {
  href = "";
}

if (href.startsWith("chrome-extension://")) {
  let listener = null;
  const early = [];
  ipcRenderer.on(DOWN, (_event, message) => {
    if (!listener) {
      if (early.length < MAX_EARLY) early.push(message);
      return;
    }
    try {
      listener(message);
    } catch {
      // The worker's handler threw; nothing to do here.
    }
  });
  contextBridge.exposeInMainWorld(
    "surffishExtensionWorker",
    Object.freeze({
      send: (message) => ipcRenderer.send(UP, message),
      call: (method, args) => ipcRenderer.invoke(CALL, method, args),
      onMessage: (fn) => {
        if (typeof fn !== "function" || listener) return;
        listener = fn;
        for (const message of early.splice(0)) {
          try {
            fn(message);
          } catch {
            // ignore
          }
        }
      },
    }),
  );
}
