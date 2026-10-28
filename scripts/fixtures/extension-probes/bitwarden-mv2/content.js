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

const browserApi = typeof browser === "undefined" ? null : browser;
const result = {
  backgroundReply: false,
  backgroundError: null,
  storageLocalRoundTrip: false,
  storageError: null,
  storageOnChangedEvent: false,
  storageOnChangedKeys: [],
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
    browserNamespace: Boolean(browserApi),
    browserStorageSession: hasPath(browserApi, "storage.session.get"),
  },
};

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      result.storageOnChangedKeys.push(...Object.keys(changes));
      if (changes.surffishContentProbe) result.storageOnChangedEvent = true;
    }
  });
}

let pending = 2;
function finishOne() {
  pending -= 1;
  if (pending === 0)
    document.documentElement.dataset.surffishExtensionProbe =
      JSON.stringify(result);
}

chrome.runtime.sendMessage({ type: "surffish-extension-probe" }, (response) => {
  result.backgroundReply = Boolean(response);
  result.backgroundError = chrome.runtime.lastError?.message || null;
  result.background = response || null;
  finishOne();
});

chrome.storage.local.set({ surffishContentProbe: "stored" }, () => {
  const setError = chrome.runtime.lastError?.message;
  chrome.storage.local.get("surffishContentProbe", (values) => {
    const getError = chrome.runtime.lastError?.message;
    result.storageLocalRoundTrip = values?.surffishContentProbe === "stored";
    result.storageError = setError || getError || null;
    setTimeout(finishOne, 150);
  });
});
