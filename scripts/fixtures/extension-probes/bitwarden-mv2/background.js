function alarmsCreateGet() {
  return new Promise((resolve) => {
    if (
      typeof chrome.alarms?.create !== "function" ||
      typeof chrome.alarms?.get !== "function"
    ) {
      resolve({
        available: false,
        createGet: false,
        error: "alarms API unavailable",
      });
      return;
    }
    const name = "surffish-bitwarden-probe-once";
    try {
      chrome.alarms.create(name, { when: Date.now() + 60_000 });
      const timeout = setTimeout(
        () =>
          resolve({
            available: true,
            createGet: false,
            error: "alarm get timed out",
          }),
        3000,
      );
      chrome.alarms.get(name, (alarm) => {
        clearTimeout(timeout);
        const error = chrome.runtime.lastError?.message || null;
        chrome.alarms.clear(name);
        resolve({
          available: true,
          createGet: Boolean(alarm) && !error,
          error,
        });
      });
    } catch (error) {
      resolve({ available: true, createGet: false, error: String(error) });
    }
  });
}

function storageLocalRoundTrip() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ surffishExtensionProbe: "stored" }, () => {
      const setError = chrome.runtime.lastError?.message;
      chrome.storage.local.get("surffishExtensionProbe", (values) => {
        const getError = chrome.runtime.lastError?.message;
        resolve({
          roundTrip: values?.surffishExtensionProbe === "stored",
          error: setError || getError || null,
        });
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "surffish-extension-probe") return false;

  const apis = {
    runtime: typeof chrome.runtime?.getManifest === "function",
    storageLocal: typeof chrome.storage?.local?.get === "function",
    storageSession: typeof chrome.storage?.session?.get === "function",
    storageOnChanged:
      typeof chrome.storage?.onChanged?.addListener === "function",
    alarms: typeof chrome.alarms?.create === "function",
    idle: typeof chrome.idle?.queryState === "function",
    offscreen: typeof chrome.offscreen?.createDocument === "function",
    identity: typeof chrome.identity?.getAuthToken === "function",
    webAuthenticationProxy:
      typeof chrome.webAuthenticationProxy !== "undefined",
    webNavigation:
      typeof chrome.webNavigation?.onCompleted?.addListener === "function",
    webRequest:
      typeof chrome.webRequest?.onBeforeRequest?.addListener === "function",
    contextMenus: typeof chrome.contextMenus?.create === "function",
    notifications: typeof chrome.notifications?.create === "function",
    commands: typeof chrome.commands?.onCommand?.addListener === "function",
    browserNamespace: typeof browser !== "undefined",
  };

  Promise.all([alarmsCreateGet(), storageLocalRoundTrip()]).then(
    ([alarms, storageLocal]) => {
      sendResponse({
        backgroundKind: "background-page",
        apis,
        alarmsCreateGet: alarms.createGet,
        alarmsError: alarms.error,
        storageLocalRoundTrip: storageLocal.roundTrip,
        storageError: storageLocal.error,
      });
    },
  );
  return true;
});
