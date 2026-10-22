// Sandboxed CommonJS preload for Surffish's quick unlock panel over Bramble's popup. The panel is a
// Surffish data: page; main checks every message comes from the panel view it created.
const { contextBridge, ipcRenderer } = require("electron");

if (globalThis.location && globalThis.location.protocol === "data:") {
  contextBridge.exposeInMainWorld(
    "surffishQuickUnlock",
    Object.freeze({
      ready: () => ipcRenderer.send("bramble-quick-unlock:ready"),
      submitPin: (pin) =>
        ipcRenderer.invoke("bramble-quick-unlock:pin", String(pin)),
      touchId: () => ipcRenderer.invoke("bramble-quick-unlock:touch-id"),
      useMasterPassword: () =>
        ipcRenderer.send("bramble-quick-unlock:use-master"),
      onShow: (listener) => {
        ipcRenderer.on("bramble-quick-unlock:show", (_event, state) =>
          listener(state),
        );
      },
      onResult: (listener) => {
        ipcRenderer.on("bramble-quick-unlock:result", (_event, result) =>
          listener(result),
        );
      },
    }),
  );
}
