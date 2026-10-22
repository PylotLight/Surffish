import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  adaptWebStoreManifest,
  EXTENSION_BACKGROUND_WRAPPER_FILE,
  EXTENSION_BRIDGE_HTML,
  EXTENSION_BRIDGE_PAGE,
  EXTENSION_BRIDGE_SCRIPT,
  EXTENSION_BRIDGE_SOURCE,
  EXTENSION_SHIM_FILE,
  EXTENSION_SHIM_SOURCE,
  extensionWorkerFiles,
  injectExtensionShim,
  stageWebStoreExtension,
  writeExtensionShimFiles,
} from "./web-store-extension-adapter.ts";

const ID = "dabkegjlekdcmefifaolmdhnhdcplklo";
const manifest = {
  update_url: "https://clients2.google.com/service/update2/crx",
  manifest_version: 3,
  name: "Fixture",
  version: "1.14",
  action: { default_popup: "popup.html" },
  background: { service_worker: "background.js" },
  content_scripts: [
    { matches: ["*://news.ycombinator.com/*"], js: ["content.js"] },
    { matches: ["*://example.com/*"], js: ["main.js"], world: "MAIN" },
  ],
};

test("adapts the manifest: no update_url, store key, wrapped worker, shimmed isolated content scripts", () => {
  const { manifest: adapted, worker } = adaptWebStoreManifest(
    manifest,
    "PUBKEY",
  );
  assert.equal(adapted.update_url, undefined);
  assert.equal(adapted.key, "PUBKEY");
  assert.deepEqual(adapted.background, {
    service_worker: EXTENSION_BACKGROUND_WRAPPER_FILE,
  });
  assert.deepEqual(worker, {
    original: "background.js",
    wrapper: EXTENSION_BACKGROUND_WRAPPER_FILE,
    module: false,
  });
  const scripts = adapted.content_scripts as Array<{ js: string[] }>;
  assert.deepEqual(scripts[0]?.js, [EXTENSION_SHIM_FILE, "content.js"]);
  assert.deepEqual(scripts[1]?.js, ["main.js"]);
  assert.equal(
    manifest.update_url !== undefined,
    true,
    "the source manifest object is not mutated",
  );
  const nested = adaptWebStoreManifest(
    { ...manifest, background: { service_worker: "js/sw.js", type: "module" } },
    null,
  ).worker;
  assert.deepEqual(nested, {
    original: "js/sw.js",
    wrapper: `js/${EXTENSION_BACKGROUND_WRAPPER_FILE}`,
    module: true,
  });
});

test("injects the shim as the first script of extension pages", () => {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><script src="jquery.js"></script></head><body></body></html>';
  const adapted = injectExtensionShim(html);
  assert.ok(
    adapted.indexOf(EXTENSION_SHIM_FILE) < adapted.indexOf("jquery.js"),
  );
  assert.equal(injectExtensionShim(adapted), adapted);
  assert.ok(injectExtensionShim("<p>bare</p>").startsWith("<script"));
});

test("stages a copy without _metadata and with the shim, wrapper, and identity key", () => {
  const root = mkdtempSync(join(tmpdir(), "surffish-web-store-stage-"));
  try {
    const source = join(root, "source");
    mkdirSync(join(source, "_metadata"), { recursive: true });
    writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(source, "_metadata", "verified_contents.json"), "[]");
    writeFileSync(join(source, "background.js"), "importScripts('lib.js')");
    writeFileSync(join(source, "content.js"), "");
    writeFileSync(
      join(source, "popup.html"),
      '<html><head><script src="popup.js"></script></head></html>',
    );
    const staged = stageWebStoreExtension(
      source,
      join(root, "staged"),
      "PUBKEY",
    );
    assert.equal(staged.version, "1.14");
    assert.equal(existsSync(join(staged.stagedDirectory, "_metadata")), false);
    assert.equal(
      readFileSync(join(staged.stagedDirectory, EXTENSION_SHIM_FILE), "utf8"),
      EXTENSION_SHIM_SOURCE,
    );
    assert.equal(
      readFileSync(
        join(staged.stagedDirectory, EXTENSION_BACKGROUND_WRAPPER_FILE),
        "utf8",
      ),
      `importScripts('/${EXTENSION_SHIM_FILE}', './background.js');\n`,
    );
    assert.match(
      readFileSync(join(staged.stagedDirectory, "popup.html"), "utf8"),
      new RegExp(EXTENSION_SHIM_FILE),
    );
    assert.equal(
      JSON.parse(
        readFileSync(join(staged.stagedDirectory, "manifest.json"), "utf8"),
      ).key,
      "PUBKEY",
    );
    assert.deepEqual(extensionWorkerFiles(staged.stagedDirectory), [
      EXTENSION_BACKGROUND_WRAPPER_FILE,
      EXTENSION_SHIM_FILE,
      "background.js",
    ]);
    assert.equal(
      readFileSync(join(source, "popup.html"), "utf8").includes(
        EXTENSION_SHIM_FILE,
      ),
      false,
      "the source stays untouched",
    );
    // A newer Surffish refreshes the shim in place.
    writeFileSync(join(staged.stagedDirectory, EXTENSION_SHIM_FILE), "old");
    writeExtensionShimFiles(staged.stagedDirectory);
    assert.equal(
      readFileSync(join(staged.stagedDirectory, EXTENSION_SHIM_FILE), "utf8"),
      EXTENSION_SHIM_SOURCE,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fakeChrome() {
  const store: Record<string, unknown> = {};
  const local = {
    get: async (keys?: string | string[] | null) => {
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list.filter((key) => key in store).map((key) => [key, store[key]]),
      );
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
    clear: async () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  const brokenSync: Record<string, (...args: unknown[]) => unknown> = {
    get: () => {
      throw new Error('"sync" is not available in this instance of Chrome');
    },
  };
  const chrome = {
    runtime: {
      id: ID,
      getManifest: () => ({
        name: "Fixture",
        version: "1.14",
        permissions: ["storage", "https://x.test/*"],
        host_permissions: ["*://news.ycombinator.com/*"],
      }),
      getURL: (path: string) =>
        `chrome-extension://${ID}/${path.replace(/^\//, "")}`,
      openOptionsPage: () => {
        throw new Error("native");
      },
    },
    storage: { local, sync: brokenSync },
    tabs: { query: async (..._args: unknown[]) => [] as unknown[] },
  };
  return { chrome, store };
}

/** Values created inside the vm realm have foreign prototypes; compare their JSON shape. */
function plain(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function runShim(context: Record<string, unknown>): void {
  runInNewContext(EXTENSION_SHIM_SOURCE, {
    console,
    URL,
    Promise,
    setTimeout,
    ...context,
  });
}

test("shim: storage.sync is stored in storage.local (promise and callback forms)", async () => {
  const { chrome, store } = fakeChrome();
  const globalObject: Record<string, unknown> = { chrome };
  globalObject.globalThis = globalObject;
  runShim(globalObject);
  await chrome.storage.sync.set!({ extensionpay_api_key: "k" });
  assert.equal(store.extensionpay_api_key, "k");
  assert.deepEqual(
    plain(await chrome.storage.sync.get!("extensionpay_api_key")),
    { extensionpay_api_key: "k" },
  );
  const viaCallback = await new Promise((resolve) =>
    (chrome.storage.sync.get as (k: string, cb: (v: unknown) => void) => void)(
      "extensionpay_api_key",
      resolve,
    ),
  );
  assert.deepEqual(plain(viaCallback), { extensionpay_api_key: "k" });
});

test("shim: management.getSelf/get return minimal self info and never pro/paid state", async () => {
  const { chrome } = fakeChrome();
  const globalObject: Record<string, unknown> = { chrome };
  globalObject.globalThis = globalObject;
  runShim(globalObject); // worker context: no document
  const management = (
    chrome as unknown as {
      management: {
        getSelf(): Promise<Record<string, unknown>>;
        get(id: string): Promise<unknown>;
      };
    }
  ).management;
  const self = plain(await management.getSelf()) as Record<string, unknown>;
  assert.equal(self.id, ID);
  assert.equal(self.installType, "normal");
  assert.equal(self.enabled, true);
  assert.deepEqual(self.permissions, ["storage"]);
  assert.deepEqual(plain(await management.get(ID)), self);
  await assert.rejects(management.get("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.equal(
    /\bpro\b/i.test(EXTENSION_SHIM_SOURCE),
    false,
    "the shim never sets paid/pro flags",
  );
  assert.equal(/\bpaid\b/i.test(EXTENSION_SHIM_SOURCE), false);
});

test("shim: popup tabs calls route to the Surffish host bridge; content scripts are not given tabs", async () => {
  const { chrome } = fakeChrome();
  const calls: Array<[string, unknown]> = [];
  const host = {
    tabs: async (op: string, payload: unknown) => {
      calls.push([op, payload]);
      return op === "query"
        ? [{ id: 5, url: "https://news.ycombinator.com/news" }]
        : op === "create"
          ? { id: 9 }
          : undefined;
    },
    openOptionsPage: async () => true,
  };
  const globalObject: Record<string, unknown> = {
    chrome,
    document: {},
    location: { protocol: "chrome-extension:" },
    surffishExtensionHost: host,
  };
  globalObject.globalThis = globalObject;
  runShim(globalObject);
  const tabs = chrome.tabs as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const queried = await new Promise((resolve) =>
    tabs.query!({ active: true, currentWindow: true }, resolve),
  );
  assert.deepEqual(plain(queried), [
    { id: 5, url: "https://news.ycombinator.com/news" },
  ]);
  assert.deepEqual(
    plain(
      await tabs.create!({
        url: "https://news.ycombinator.com/news",
        active: true,
      }),
    ),
    { id: 9 },
  );
  await tabs.update!(9, { active: true });
  await tabs.reload!();
  await tabs.create!({ url: "options.html" });
  await (chrome.runtime.openOptionsPage as () => Promise<unknown>)();
  assert.deepEqual(
    calls.map(([op]) => op),
    ["query", "create", "update", "reload", "create"],
  );
  assert.deepEqual(plain(calls[2]?.[1]), { tabId: 9, active: true });
  assert.deepEqual(plain(calls[3]?.[1]), { bypassCache: false });
  assert.equal(
    (calls[4]?.[1] as { url: string }).url,
    `chrome-extension://${ID}/options.html`,
  );

  const content = fakeChrome();
  const contentGlobal: Record<string, unknown> = {
    chrome: content.chrome,
    document: {},
    location: { protocol: "https:" },
    surffishExtensionHost: host,
  };
  contentGlobal.globalThis = contentGlobal;
  runShim(contentGlobal);
  assert.deepEqual(
    plain(await content.chrome.tabs.query()),
    [],
    "content scripts keep Electron’s own tabs",
  );
  assert.equal(
    (content.chrome as Record<string, unknown>).management,
    undefined,
    "content scripts get no management stub",
  );
  await content.chrome.storage.sync.set!({ a: 1 });
  assert.equal(content.store.a, 1);
});

/** A chrome.runtime.onMessage-like event plus a recorder for sendMessage. */
function fakeRuntimeMessaging() {
  const listeners: Array<
    (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void,
    ) => unknown
  > = [];
  const sent: unknown[] = [];
  const onMessage = {
    addListener(listener: (typeof listeners)[number]) {
      listeners.push(listener);
    },
    removeListener(listener: (typeof listeners)[number]) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    hasListener(listener: (typeof listeners)[number]) {
      return listeners.includes(listener);
    },
  };
  const deliver = (message: unknown) =>
    listeners.map((listener) => listener(message, { id: ID }, () => {}));
  return {
    onMessage,
    sendMessage: async (message: unknown) => {
      sent.push(message);
      return undefined;
    },
    sent,
    deliver,
    listeners,
  };
}

test("shim (worker): webNavigation from bridge events, bridge messages hidden, DNR changes reported, bridge tab hidden", async () => {
  const { chrome } = fakeChrome();
  const messaging = fakeRuntimeMessaging();
  const dnrCalls: unknown[] = [];
  const runtime = chrome.runtime as Record<string, unknown>;
  runtime.onMessage = messaging.onMessage;
  runtime.sendMessage = messaging.sendMessage;
  (chrome as Record<string, unknown>).declarativeNetRequest = {
    updateDynamicRules: async (options: unknown) => {
      dnrCalls.push(options);
    },
    getDynamicRules: async () => [],
  };
  (chrome as Record<string, unknown>).tabs = {
    query: async () => [
      { id: 1, url: "https://a.test/" },
      { id: 2, url: `chrome-extension://${ID}/surffish-bridge.html` },
    ],
  };
  const globalObject: Record<string, unknown> = { chrome };
  globalObject.globalThis = globalObject;
  runShim(globalObject);

  const seen: unknown[] = [];
  const extensionListener = (message: unknown) => {
    seen.push(message);
  };
  (
    chrome.runtime as unknown as { onMessage: typeof messaging.onMessage }
  ).onMessage.addListener(extensionListener);
  const webNavigation = (
    chrome as unknown as {
      webNavigation: Record<
        string,
        {
          addListener(
            fn: (details: Record<string, unknown>) => void,
            filter?: unknown,
          ): void;
        }
      >;
    }
  ).webNavigation;
  const committed: unknown[] = [];
  const filtered: unknown[] = [];
  webNavigation.onCommitted!.addListener((details) =>
    committed.push(details.url),
  );
  webNavigation.onCompleted!.addListener(
    (details) => filtered.push(details.url),
    { url: [{ hostSuffix: "b.test" }] },
  );

  messaging.deliver({
    __surffishBridge: {
      type: "event",
      name: "onCommitted",
      details: { tabId: 1, frameId: 0, url: "https://a.test/" },
    },
  });
  messaging.deliver({
    __surffishBridge: {
      type: "event",
      name: "onCompleted",
      details: { tabId: 1, frameId: 0, url: "https://a.test/" },
    },
  });
  messaging.deliver({
    __surffishBridge: {
      type: "event",
      name: "onCompleted",
      details: { tabId: 1, frameId: 0, url: "https://www.b.test/x" },
    },
  });
  messaging.deliver({ command: "get_active_tab" });
  assert.deepEqual(committed, ["https://a.test/"]);
  assert.deepEqual(filtered, ["https://www.b.test/x"]);
  assert.deepEqual(
    plain(seen),
    [{ command: "get_active_tab" }],
    "the extension only sees its own messages",
  );
  assert.equal(
    (
      chrome.runtime as unknown as { onMessage: typeof messaging.onMessage }
    ).onMessage.hasListener(extensionListener),
    true,
  );

  await (
    chrome as unknown as {
      declarativeNetRequest: { updateDynamicRules(o: unknown): Promise<void> };
    }
  ).declarativeNetRequest.updateDynamicRules({ addRules: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dnrCalls.length, 1, "the native API still stores the rules");
  assert.deepEqual(plain(messaging.sent), [
    { __surffishBridge: { type: "dnr-changed" } },
  ]);

  const tabs = await (
    chrome.tabs as unknown as {
      query(info: unknown): Promise<Array<{ id: number }>>;
    }
  ).query({});
  assert.deepEqual(plain(tabs.map((tab) => tab.id)), [1]);
  const notifications = (
    chrome as unknown as {
      notifications: { create(id: string, options: unknown): Promise<string> };
    }
  ).notifications;
  assert.equal(
    await notifications.create("report", {}),
    "report",
    "notifications.create resolves instead of throwing",
  );
});

test("bridge page files: no shim in the bridge page, and both scripts parse", () => {
  assert.equal(
    injectExtensionShim(EXTENSION_BRIDGE_HTML),
    EXTENSION_BRIDGE_HTML,
    "the shim (which hides bridge messages) is never injected into the bridge page",
  );
  assert.ok(EXTENSION_BRIDGE_HTML.includes(`/${EXTENSION_BRIDGE_SCRIPT}`));
  assert.doesNotThrow(() => new Function(EXTENSION_SHIM_SOURCE));
  assert.doesNotThrow(() => new Function(EXTENSION_BRIDGE_SOURCE));
  const root = mkdtempSync(join(tmpdir(), "surffish-bridge-"));
  try {
    writeExtensionShimFiles(root);
    assert.ok(existsSync(join(root, EXTENSION_BRIDGE_PAGE)));
    assert.equal(
      readFileSync(join(root, EXTENSION_BRIDGE_SCRIPT), "utf8"),
      EXTENSION_BRIDGE_SOURCE,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bridge page relays events to the worker and reports DNR state to Surffish", async () => {
  const messaging = fakeRuntimeMessaging();
  const toMain: unknown[] = [];
  let hostListener: ((message: unknown) => void) | null = null;
  const enabledCalls: unknown[] = [];
  let enabled: string[] = [];
  const chrome = {
    runtime: {
      id: ID,
      onMessage: messaging.onMessage,
      sendMessage: messaging.sendMessage,
    },
    declarativeNetRequest: {
      getEnabledRulesets: async () => enabled,
      updateEnabledRulesets: async (options: {
        enableRulesetIds: string[];
        disableRulesetIds: string[];
      }) => {
        enabledCalls.push(options);
        enabled = [
          ...enabled.filter((id) => !options.disableRulesetIds.includes(id)),
          ...options.enableRulesetIds,
        ];
      },
      getDynamicRules: async () => [
        {
          id: 1,
          action: { type: "allow" },
          condition: { initiatorDomains: ["a.test"] },
        },
      ],
      getSessionRules: async () => [],
      getDisabledRuleIds: async () => [],
    },
  };
  const host = {
    send: (message: unknown) => {
      toMain.push(message);
    },
    call: async () => [],
    onMessage: (listener: (message: unknown) => void) => {
      hostListener = listener;
    },
  };
  const globalObject: Record<string, unknown> = {
    chrome,
    surffishExtensionBridge: host,
  };
  globalObject.globalThis = globalObject;
  runInNewContext(EXTENSION_BRIDGE_SOURCE, {
    console,
    Promise,
    setTimeout,
    ...globalObject,
  });
  assert.deepEqual(plain(toMain), [{ type: "ready" }]);
  hostListener!({ type: "init", enabledRulesets: ["ruleset_1"] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(plain(enabledCalls), [
    { enableRulesetIds: ["ruleset_1"], disableRulesetIds: [] },
  ]);
  const state = toMain.at(-1) as Record<string, unknown>;
  assert.equal(state.type, "dnr-state");
  assert.deepEqual(plain(state.enabledRulesets), ["ruleset_1"]);
  assert.equal((state.dynamicRules as unknown[]).length, 1);
  hostListener!({
    type: "event",
    name: "onCommitted",
    details: { tabId: 3, frameId: 0, url: "https://a.test/" },
  });
  assert.deepEqual(plain(messaging.sent), [
    {
      __surffishBridge: {
        type: "event",
        name: "onCommitted",
        details: { tabId: 3, frameId: 0, url: "https://a.test/" },
      },
    },
  ]);
});

function fakeEvent<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = [];
  return {
    listeners,
    addListener(listener: T) {
      listeners.push(listener);
    },
    removeListener(listener: T) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    hasListener(listener: T) {
      return listeners.includes(listener);
    },
    fire(...args: Parameters<T>) {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("shim (worker, service-worker preload): events, calls and DNR state go over the direct channel", async () => {
  const { chrome } = fakeChrome();
  const messaging = fakeRuntimeMessaging();
  const runtime = chrome.runtime as Record<string, unknown>;
  runtime.onMessage = messaging.onMessage;
  runtime.sendMessage = messaging.sendMessage;
  let enabled: string[] = [];
  const dynamic: unknown[] = [];
  (chrome as Record<string, unknown>).declarativeNetRequest = {
    updateDynamicRules: async (options: { addRules?: unknown[] }) => {
      dynamic.push(...(options.addRules ?? []));
    },
    getDynamicRules: async () => dynamic,
    getSessionRules: async () => [],
    getEnabledRulesets: async () => enabled,
    updateEnabledRulesets: async (options: {
      enableRulesetIds: string[];
      disableRulesetIds: string[];
    }) => {
      enabled = [
        ...enabled.filter((id) => !options.disableRulesetIds.includes(id)),
        ...options.enableRulesetIds,
      ];
    },
  };
  const toMain = [] as Array<Record<string, unknown>>;
  const calls: unknown[] = [];
  let hostListener = null as ((message: unknown) => void) | null;
  const host = {
    send: (message: Record<string, unknown>) => {
      toMain.push(JSON.parse(JSON.stringify(message)));
    },
    call: async (method: string, args: unknown) => {
      calls.push([method, args]);
      return [{ frameId: 0 }];
    },
    onMessage: (listener: (message: unknown) => void) => {
      hostListener = listener;
    },
  };
  const globalObject: Record<string, unknown> = {
    chrome,
    surffishExtensionWorker: host,
  };
  globalObject.globalThis = globalObject;
  runShim(globalObject);
  assert.ok(hostListener, "the shim listens on the worker channel");

  const webNavigation = (
    chrome as unknown as {
      webNavigation: Record<
        string,
        {
          addListener(fn: (details: Record<string, unknown>) => void): void;
        } & { getAllFrames?: unknown }
      >;
    }
  ).webNavigation;
  const committed: unknown[] = [];
  webNavigation.onCommitted!.addListener((details) =>
    committed.push(details.url),
  );
  webNavigation.onCommitted!.addListener(() => {});
  assert.deepEqual(
    toMain,
    [{ type: "listen", name: "onCommitted" }],
    "the first listener per event is reported once",
  );

  hostListener!({
    type: "init",
    enabledRulesets: ["ruleset_1"],
    webNavigation: true,
  });
  await tick(5);
  assert.deepEqual(
    enabled,
    ["ruleset_1"],
    "manifest rulesets mirrored into the native API",
  );
  const state = toMain.find(
    (message) => message.type === "dnr-state",
  ) as Record<string, unknown>;
  assert.deepEqual(state.enabledRulesets, ["ruleset_1"]);
  assert.deepEqual(
    toMain[1],
    { type: "ready", listening: ["onCommitted"] },
    "ready comes first (queued events flow at once) and lists the listened events",
  );
  assert.equal(toMain.at(-1)!.type, "dnr-state");

  hostListener!({
    type: "event",
    name: "onCommitted",
    details: { tabId: 1, frameId: 0, url: "https://a.test/" },
  });
  assert.deepEqual(committed, ["https://a.test/"]);

  const frames = await (
    webNavigation as unknown as {
      getAllFrames(details: unknown): Promise<unknown>;
    }
  ).getAllFrames({ tabId: 1 });
  assert.deepEqual(plain(frames), [{ frameId: 0 }]);
  assert.deepEqual(plain(calls), [
    ["webNavigation.getAllFrames", { tabId: 1 }],
  ]);

  toMain.length = 0;
  await (
    chrome as unknown as {
      declarativeNetRequest: { updateDynamicRules(o: unknown): Promise<void> };
    }
  ).declarativeNetRequest.updateDynamicRules({ addRules: [{ id: 7 }] });
  await tick(5);
  assert.equal(messaging.sent.length, 0, "no runtime message to a bridge page");
  assert.deepEqual(
    ((toMain.at(-1) as Record<string, unknown>).dynamicRules as unknown[])
      .length,
    1,
    "the worker reports the new rules itself",
  );

  // A rule change in one of the extension's pages: the page tells the worker, the worker reports.
  toMain.length = 0;
  for (const listener of messaging.listeners)
    listener(
      { __surffishBridge: { type: "dnr-changed" } },
      { id: ID, url: `chrome-extension://${ID}/options.html` },
      () => {},
    );
  await tick(5);
  assert.equal(toMain.at(-1)!.type, "dnr-state");
  // ...but not when the message comes from a content script on a web page.
  toMain.length = 0;
  for (const listener of messaging.listeners)
    listener(
      { __surffishBridge: { type: "dnr-changed" } },
      { id: ID, url: "https://evil.test/" },
      () => {},
    );
  await tick(5);
  assert.equal(toMain.length, 0);
});

function storageChrome() {
  const { chrome, store } = fakeChrome();
  const messaging = fakeRuntimeMessaging();
  const runtime = chrome.runtime as Record<string, unknown>;
  runtime.onMessage = messaging.onMessage;
  runtime.sendMessage = messaging.sendMessage;
  const onChanged =
    fakeEvent<(changes: Record<string, unknown>, area: string) => void>();
  (chrome.storage as Record<string, unknown>).onChanged = onChanged;
  return { chrome, store, messaging, onChanged };
}

test("shim (worker): storage.onChanged fires for the worker’s own writes and for changes relayed by its pages, once", async () => {
  const { chrome, messaging } = storageChrome();
  const globalObject: Record<string, unknown> = { chrome };
  globalObject.globalThis = globalObject;
  runShim(globalObject);
  const storage = chrome.storage as unknown as {
    local: {
      set(items: unknown, cb?: () => void): Promise<void> | undefined;
      remove(keys: unknown): Promise<void>;
      clear(): Promise<void>;
    };
    onChanged: {
      addListener(
        fn: (changes: Record<string, unknown>, area: string) => void,
      ): void;
      hasListeners(): boolean;
    };
  };
  const events: unknown[] = [];
  storage.onChanged.addListener((changes, area) =>
    events.push([area, plain(changes)]),
  );
  assert.equal(storage.onChanged.hasListeners(), true);

  await storage.local.set({ a: 1, b: { x: 1 } });
  await storage.local.set({ a: 1 });
  assert.deepEqual(
    events,
    [["local", { a: { newValue: 1 }, b: { newValue: { x: 1 } } }]],
    "own write reported; an unchanged value is not",
  );
  await new Promise<void>((resolve) => storage.local.set({ a: 2 }, resolve));
  assert.deepEqual(
    events.at(-1),
    ["local", { a: { oldValue: 1, newValue: 2 } }],
    "callback form, with oldValue",
  );

  // Two open pages relay the same native event for the worker's write: dropped (already reported).
  const relay = (
    area: string,
    changes: unknown,
    url = `chrome-extension://${ID}/popup.html`,
  ) => {
    for (const listener of messaging.listeners)
      listener(
        { __surffishBridge: { type: "storage-changed", area, changes } },
        { id: ID, url },
        () => {},
      );
  };
  const before = events.length;
  relay("local", { a: { oldValue: 1, newValue: 2 } });
  relay(
    "local",
    { a: { oldValue: 1, newValue: 2 } },
    `chrome-extension://${ID}/options.html`,
  );
  assert.equal(
    events.length,
    before,
    "the worker’s own write is not reported twice",
  );

  // A page's own write: reported once even if two pages relay it.
  relay("local", { theme: { newValue: "dark" } });
  relay(
    "local",
    { theme: { newValue: "dark" } },
    `chrome-extension://${ID}/options.html`,
  );
  assert.deepEqual(events.slice(before), [
    ["local", { theme: { newValue: "dark" } }],
  ]);
  // Not from a content script.
  relay("local", { spoofed: { newValue: 1 } }, "https://evil.test/");
  assert.equal(events.length, before + 1);

  await storage.local.remove("a");
  assert.deepEqual(events.at(-1), ["local", { a: { oldValue: 2 } }]);
  await storage.local.clear();
  assert.deepEqual(events.at(-1), ["local", { b: { oldValue: { x: 1 } } }]);
});

test("shim (worker): replays stop once the native storage event fires", async () => {
  const { chrome, onChanged } = storageChrome();
  const globalObject: Record<string, unknown> = { chrome };
  globalObject.globalThis = globalObject;
  runShim(globalObject);
  const storage = chrome.storage as unknown as {
    local: { set(items: unknown): Promise<void> };
    onChanged: {
      addListener(
        fn: (changes: Record<string, unknown>, area: string) => void,
      ): void;
    };
  };
  const events: unknown[] = [];
  storage.onChanged.addListener((changes, area) =>
    events.push([area, plain(changes)]),
  );
  onChanged.fire({ n: { newValue: 1 } }, "local");
  assert.equal(events.length, 1, "native event delivered to the listener");
  await storage.local.set({ q: 1 });
  assert.equal(
    events.length,
    1,
    "no synthetic event once Electron fires its own",
  );
});

test("shim (page): relays native storage changes to the worker, large values as keys only, not from the bridge page", () => {
  for (const pathname of ["/popup.html", "/surffish-bridge.html"]) {
    const { chrome, messaging, onChanged } = storageChrome();
    const globalObject: Record<string, unknown> = {
      chrome,
      document: {},
      location: { protocol: "chrome-extension:", pathname },
    };
    globalObject.globalThis = globalObject;
    runShim(globalObject);
    onChanged.fire(
      { small: { newValue: 1 }, big: { newValue: "x".repeat(300_000) } },
      "local",
    );
    if (pathname === "/surffish-bridge.html") {
      assert.equal(messaging.sent.length, 0);
      continue;
    }
    assert.deepEqual(plain(messaging.sent), [
      {
        __surffishBridge: {
          type: "storage-changed",
          area: "local",
          changes: { small: { newValue: 1 }, big: {} },
        },
      },
    ]);
  }
});
