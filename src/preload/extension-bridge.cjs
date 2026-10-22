// Sandboxed CommonJS preload for Surffish's hidden extension bridge page (surffish-bridge.html).
// The page relays between the main process and the extension's service worker (webNavigation
// events, declarativeNetRequest state); main re-checks that every message comes from the bridge
// page it created for that extension.
const { contextBridge, ipcRenderer } = require("electron");

if (
  globalThis.location &&
  globalThis.location.protocol === "chrome-extension:" &&
  /\/surffish-bridge\.html$/.test(globalThis.location.pathname)
) {
  contextBridge.exposeInMainWorld(
    "surffishExtensionBridge",
    Object.freeze({
      send: (message) =>
        ipcRenderer.send("surffish:extension-bridge:up", message),
      call: (method, args) =>
        ipcRenderer.invoke("surffish:extension-bridge:call", method, args),
      onMessage: (listener) => {
        ipcRenderer.on("surffish:extension-bridge:down", (_event, message) =>
          listener(message),
        );
      },
    }),
  );
}
