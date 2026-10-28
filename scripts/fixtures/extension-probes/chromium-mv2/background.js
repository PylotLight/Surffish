/* global chrome */
function hasPath(root, path) {
  return (
    path
      .split(".")
      .reduce(
        (value, key) => (value == null ? undefined : value[key]),
        root,
      ) !== undefined
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "surffish-extension-probe") return false;

  const result = {
    backgroundKind:
      typeof ServiceWorkerGlobalScope === "function" &&
      self instanceof ServiceWorkerGlobalScope
        ? "service-worker"
        : "background-page",
    apis: {
      runtime: hasPath(chrome, "runtime.getManifest"),
      storageLocal: hasPath(chrome, "storage.local.get"),
      storageSession: hasPath(chrome, "storage.session.get"),
      storageOnChanged: hasPath(chrome, "storage.onChanged"),
      alarms: hasPath(chrome, "alarms.create"),
      idle: hasPath(chrome, "idle.queryState"),
      offscreen: hasPath(chrome, "offscreen.createDocument"),
      identity: hasPath(chrome, "identity.getAuthToken"),
      webAuthenticationProxy: hasPath(chrome, "webAuthenticationProxy"),
      webNavigation: hasPath(chrome, "webNavigation.onCompleted"),
      contextMenus: hasPath(chrome, "contextMenus.create"),
      notifications: hasPath(chrome, "notifications.create"),
      commands: hasPath(chrome, "commands.onCommand"),
      browserNamespace: typeof browser !== "undefined",
    },
  };

  chrome.storage.local.set({ surffishExtensionProbe: "stored" }, () => {
    const setError = chrome.runtime.lastError?.message;
    chrome.storage.local.get("surffishExtensionProbe", (values) => {
      const getError = chrome.runtime.lastError?.message;
      sendResponse({
        ...result,
        storageLocalRoundTrip: values?.surffishExtensionProbe === "stored",
        storageError: setError || getError || null,
      });
    });
  });
  return true;
});
