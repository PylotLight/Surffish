// Electron sandboxed preloads must be CommonJS. Keep this bridge deliberately narrow to Bramble UI operations.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "surffishBramble",
  Object.freeze({
    openOptionsPage: () =>
      ipcRenderer.invoke("browser:bramble:open-options-from-ui"),
    writeClipboard: (text) =>
      ipcRenderer.invoke("browser:bramble:clipboard-write", text),
    // Bramble's setup tab, once a vault was created / joined / restored (bramble-setup-close-page.cjs).
    closeSetupTab: () => ipcRenderer.invoke("browser:bramble:setup-done"),
    // Only honoured from Bramble's hidden offscreen page (see ipc.ts).
    openPopout: (url) => ipcRenderer.invoke("browser:bramble:popout-open", url),
    closePopout: () => ipcRenderer.invoke("browser:bramble:popout-close"),
    biometrics:
      globalThis.location &&
      globalThis.location.protocol === "chrome-extension:"
        ? Object.freeze({
            available: () =>
              ipcRenderer.invoke("browser:bramble:biometrics:available"),
            create: (saltBase64) =>
              ipcRenderer.invoke(
                "browser:bramble:biometrics:create",
                saltBase64,
              ),
            get: (saltBase64) =>
              ipcRenderer.invoke("browser:bramble:biometrics:get", saltBase64),
          })
        : undefined,
  }),
);

// chrome.tabs for Bramble's popup and pages in Surffish tabs (the alias script installs the shim; the
// main process only answers Bramble's popup and Bramble tabs). Same bridge Web Store extension pages use.
if (
  globalThis.location &&
  globalThis.location.protocol === "chrome-extension:"
) {
  contextBridge.exposeInMainWorld(
    "surffishExtensionHost",
    Object.freeze({
      tabs: (op, payload) =>
        ipcRenderer.invoke("browser:extensions:host-tabs", op, payload),
    }),
  );
}
