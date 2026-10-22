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

let observedLocalStorageChange = false;
const observedLocalStorageChangeKeys = [];
if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      observedLocalStorageChangeKeys.push(...Object.keys(changes));
      if (changes.surffishMV3StorageProbe || changes.surffishContentProbe)
        observedLocalStorageChange = true;
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("SURFFISH_EXTENSION_PROBE_BACKGROUND_STARTED");
});

function storageRoundTrip(area, key) {
  return new Promise((resolve) => {
    if (
      !area ||
      typeof area.set !== "function" ||
      typeof area.get !== "function"
    ) {
      resolve({
        available: false,
        roundTrip: false,
        error: "storage area unavailable",
      });
      return;
    }
    area.set({ [key]: "stored" }, () => {
      const setError = chrome.runtime.lastError?.message;
      if (setError) {
        resolve({ available: true, roundTrip: false, error: setError });
        return;
      }
      area.get(key, (values) => {
        const getError = chrome.runtime.lastError?.message;
        resolve({
          available: true,
          roundTrip: !getError && values?.[key] === "stored",
          error: getError || null,
        });
      });
    });
  });
}

function alarmCreateGet() {
  return new Promise((resolve) => {
    if (
      !chrome.alarms ||
      typeof chrome.alarms.create !== "function" ||
      typeof chrome.alarms.get !== "function"
    ) {
      resolve({
        available: false,
        createGet: false,
        error: "alarms API unavailable",
      });
      return;
    }
    const name = "surffish-extension-probe-once";
    try {
      chrome.alarms.create(name, { when: Date.now() + 60_000 });
      chrome.alarms.get(name, (alarm) => {
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

function idleQuery() {
  return new Promise((resolve) => {
    if (!chrome.idle || typeof chrome.idle.queryState !== "function") {
      resolve({ available: false, state: null, error: "idle API unavailable" });
      return;
    }
    try {
      chrome.idle.queryState(15, (state) => {
        const error = chrome.runtime.lastError?.message || null;
        resolve({ available: true, state: state || null, error });
      });
    } catch (error) {
      resolve({ available: true, state: null, error: String(error) });
    }
  });
}

async function offscreenCreateClose() {
  if (
    !chrome.offscreen ||
    typeof chrome.offscreen.createDocument !== "function"
  ) {
    return {
      available: false,
      createClose: false,
      error: "offscreen API unavailable",
    };
  }
  let created = false;
  try {
    await Promise.race([
      chrome.offscreen
        .createDocument({
          url: "offscreen.html",
          reasons: ["DOM_PARSER"],
          justification:
            "Exercise the offscreen extension API in a local no-secrets test fixture.",
        })
        .then(() => {
          created = true;
        }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("createDocument timed out")), 5000),
      ),
    ]);
    await chrome.offscreen.closeDocument();
    return { available: true, createClose: true, error: null };
  } catch (error) {
    if (created) {
      try {
        await chrome.offscreen.closeDocument();
      } catch {}
    }
    return { available: true, createClose: false, error: String(error) };
  }
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
      contextMenus: typeof chrome.contextMenus?.create === "function",
      notifications: typeof chrome.notifications?.create === "function",
      commands: typeof chrome.commands?.onCommand?.addListener === "function",
      browserNamespace: typeof browser !== "undefined",
      browserStorageSession:
        typeof browser !== "undefined" &&
        typeof browser.storage?.session?.get === "function",
    },
  };

  Promise.all([
    storageRoundTrip(chrome.storage?.local, "surffishMV3StorageProbe").then(
      async (storageLocal) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          storageLocal,
          storageOnChangedEvent: observedLocalStorageChange,
        };
      },
    ),
    storageRoundTrip(chrome.storage?.session, "surffishMV3SessionProbe"),
    alarmCreateGet(),
    idleQuery(),
    offscreenCreateClose(),
  ])
    .then(
      ([
        localResult,
        sessionResult,
        alarmsResult,
        idleResult,
        offscreenResult,
      ]) => {
        sendResponse({
          ...result,
          storageLocalRoundTrip: localResult.storageLocal.roundTrip,
          storageLocalError: localResult.storageLocal.error,
          storageOnChangedEvent: localResult.storageOnChangedEvent,
          storageOnChangedKeys: observedLocalStorageChangeKeys,
          storageSessionRoundTrip: sessionResult.roundTrip,
          storageSessionError: sessionResult.error,
          alarmsCreateGet: alarmsResult.createGet,
          alarmsError: alarmsResult.error,
          idleQueryState: idleResult.state,
          idleError: idleResult.error,
          offscreenCreateClose: offscreenResult.createClose,
          offscreenError: offscreenResult.error,
        });
      },
    )
    .catch((error) => {
      sendResponse({ ...result, probeError: String(error) });
    });
  return true;
});
